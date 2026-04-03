import { readFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";
import yaml from "js-yaml";

type ProjectYaml = {
  repo?: string;
  submittedBy?: string;
  banner?: string;
  npm?: string;
  website?: string;
  addedAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

type ValidationResult = {
  file: string;
  status: "new" | "modified" | "deleted";
  errors: string[];
};

const REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const NPM_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const NEW_FILE_ALLOWED_FIELDS = new Set([
  "repo",
  "submittedBy",
  "banner",
  "npm",
  "website",
]);
const MODIFIED_FILE_ALLOWED_FIELDS = new Set([
  "repo",
  "submittedBy",
  "banner",
  "npm",
  "website",
  "addedAt",
  "updatedAt",
]);

// Parse --new, --modified, and --deleted arguments
function parseArgs(args: string[]): {
  newFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
} {
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const deletedFiles: string[] = [];
  let mode: "new" | "modified" | "deleted" | null = null;

  for (const arg of args) {
    if (arg === "--new") {
      mode = "new";
    } else if (arg === "--modified") {
      mode = "modified";
    } else if (arg === "--deleted") {
      mode = "deleted";
    } else if (arg.endsWith(".yaml")) {
      if (mode === "modified") {
        modifiedFiles.push(arg);
      } else if (mode === "deleted") {
        deletedFiles.push(arg);
      } else {
        newFiles.push(arg);
      }
    }
  }

  return { newFiles, modifiedFiles, deletedFiles };
}

const { newFiles, modifiedFiles, deletedFiles } = parseArgs(
  process.argv.slice(2),
);
const filesToValidate = [...newFiles, ...modifiedFiles];
const allChangedFiles = [...filesToValidate, ...deletedFiles];

if (allChangedFiles.length === 0) {
  console.log("No YAML files to validate.");
  process.exit(0);
}

const modifiedSet = new Set(modifiedFiles);

// Load all existing repos for duplicate checking (from the PR branch, i.e. working tree)
const allProjectFiles = readdirSync("projects").filter((f) =>
  f.endsWith(".yaml"),
);
const existingRepos = new Map<string, string>();
for (const file of allProjectFiles) {
  try {
    const content = readFileSync(join("projects", file), "utf8");
    const data = yaml.load(content) as ProjectYaml | null;
    if (data?.repo) existingRepos.set(data.repo, file);
  } catch {
    // Skip unparseable files
  }
}

// Get base branch file content from git for addedAt comparison
function getBaseBranchContent(filePath: string): ProjectYaml | null {
  try {
    const baseBranch = process.env.GITHUB_BASE_REF || "main";
    const content = execSync(
      `git show origin/${baseBranch}:${filePath}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return yaml.load(content) as ProjectYaml | null;
  } catch {
    return null;
  }
}

let hasErrors = false;
const results: ValidationResult[] = [];

// Validate deleted files — just log them, no errors
for (const filePath of deletedFiles) {
  const filename = basename(filePath);

  // Check the file is actually gone from the working tree
  if (existsSync(filePath)) {
    results.push({
      file: filename,
      status: "deleted",
      errors: [
        "File is marked as deleted but still exists in the working tree",
      ],
    });
    hasErrors = true;
  } else {
    results.push({ file: filename, status: "deleted", errors: [] });
  }
}

// Validate new and modified files
for (const filePath of filesToValidate) {
  const errors: string[] = [];
  const filename = basename(filePath);
  const isModified = modifiedSet.has(filePath);
  const status = isModified ? "modified" : "new";
  const allowedFields = isModified
    ? MODIFIED_FILE_ALLOWED_FIELDS
    : NEW_FILE_ALLOWED_FIELDS;

  let data: ProjectYaml;
  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== "object") {
      errors.push("File must contain a YAML object");
      results.push({ file: filename, status, errors });
      hasErrors = true;
      continue;
    }
    data = parsed as ProjectYaml;
  } catch (e) {
    errors.push(`YAML parse error: ${(e as Error).message}`);
    results.push({ file: filename, status, errors });
    hasErrors = true;
    continue;
  }

  // Check for unknown fields
  for (const key of Object.keys(data)) {
    if (!allowedFields.has(key)) {
      if (!isModified && (key === "addedAt" || key === "updatedAt")) {
        errors.push(
          `\`${key}\` must not be included in new submissions — it will be set automatically after merge`,
        );
      } else {
        errors.push(
          `Unknown field \`${key}\` — only allowed: ${[...allowedFields].join(", ")}`,
        );
      }
    }
  }

  // For modified files, verify addedAt hasn't been changed
  if (isModified && data.addedAt) {
    const baseData = getBaseBranchContent(filePath);
    if (baseData?.addedAt && data.addedAt !== baseData.addedAt) {
      errors.push(
        `\`addedAt\` must not be changed — expected \`${baseData.addedAt}\`, got \`${data.addedAt}\``,
      );
    }
  }

  // Required fields
  if (!data.repo) errors.push("Missing required field: `repo`");
  if (!data.submittedBy)
    errors.push("Missing required field: `submittedBy`");

  // repo format
  if (data.repo && !REPO_RE.test(data.repo)) {
    errors.push(
      `\`repo\` must match owner/repo format, got: \`${data.repo}\``,
    );
  }

  // Filename convention: {owner}-{repo}.yaml
  if (data.repo && REPO_RE.test(data.repo)) {
    const [owner, repoName] = data.repo.split("/");
    const expectedFilename = `${owner}-${repoName}.yaml`;
    if (filename !== expectedFilename) {
      errors.push(
        `Filename must be \`${expectedFilename}\` for repo \`${data.repo}\`, got \`${filename}\``,
      );
    }
  }

  // banner must be a valid HTTPS URL
  if (data.banner != null) {
    try {
      const url = new URL(data.banner);
      if (url.protocol !== "https:")
        errors.push("`banner` must use HTTPS");
    } catch {
      errors.push(
        `\`banner\` is not a valid URL: \`${data.banner}\``,
      );
    }
  }

  // website must be https
  if (data.website != null) {
    try {
      const url = new URL(data.website);
      if (url.protocol !== "https:")
        errors.push("`website` must use HTTPS");
    } catch {
      errors.push(
        `\`website\` is not a valid URL: \`${data.website}\``,
      );
    }
  }

  // npm package name
  if (data.npm != null) {
    if (typeof data.npm !== "string" || !NPM_RE.test(data.npm)) {
      errors.push(
        `\`npm\` must be a valid npm package name, got: \`${data.npm}\``,
      );
    }
  }

  // Duplicate check (against other files, not self)
  if (data.repo && REPO_RE.test(data.repo)) {
    const existingFile = existingRepos.get(data.repo);
    if (existingFile && existingFile !== filename) {
      errors.push(
        `Repo \`${data.repo}\` already exists in \`${existingFile}\``,
      );
    }
  }

  if (errors.length > 0) hasErrors = true;
  results.push({ file: filename, status, errors });
}

// Check repos exist on GitHub (only for new/modified, not deleted)
const token = process.env.GITHUB_TOKEN;
if (token) {
  for (const result of results) {
    if (result.errors.length > 0 || result.status === "deleted") continue;
    const filePath = filesToValidate.find(
      (f) => basename(f) === result.file,
    );
    if (!filePath) continue;
    const data = yaml.load(
      readFileSync(filePath, "utf8"),
    ) as ProjectYaml | null;
    if (!data?.repo) continue;

    try {
      const res = await fetch(
        `https://api.github.com/repos/${data.repo}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "AzGitCommunity-Showcase",
          },
        },
      );
      if (res.status === 404) {
        result.errors.push(
          `Repository \`${data.repo}\` does not exist or is not public on GitHub`,
        );
        hasErrors = true;
      } else if (res.ok) {
        const repoData = (await res.json()) as { private: boolean };
        if (repoData.private) {
          result.errors.push(
            `Repository \`${data.repo}\` is private — only public repos are allowed`,
          );
          hasErrors = true;
        }
      }
    } catch {
      // Network error — skip check, don't fail the PR for this
    }
  }
}

// Output results
console.log("");
for (const { file, status, errors } of results) {
  const tag =
    status === "deleted" ? "[deleted]" : status === "new" ? "[new]" : "[modified]";
  if (errors.length === 0) {
    console.log(`  ${tag} ${file} — valid`);
  } else {
    console.log(`  ${tag} ${file}:`);
    for (const err of errors) {
      console.log(`    - ${err}`);
    }
  }
}
console.log("");

if (hasErrors) {
  console.log("Validation failed.");
  process.exit(1);
} else {
  console.log("All files valid.");
}
