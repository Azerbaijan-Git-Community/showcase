import { readFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";
import yaml from "js-yaml";

type ProjectYaml = {
  repo?: string;
  submittedBy?: string;
  banner?: string;
  links?: unknown;
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
const NEW_FILE_ALLOWED_FIELDS = new Set([
  "repo",
  "submittedBy",
  "banner",
  "links",
  "website",
]);
const MODIFIED_FILE_ALLOWED_FIELDS = new Set([
  "repo",
  "submittedBy",
  "banner",
  "links",
  "website",
  "addedAt",
  "updatedAt",
]);

const MAX_LINKS = 5;

// Parse --new, --modified, --deleted and --invalid arguments
function parseArgs(args: string[]): {
  newFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  invalidFiles: string[];
} {
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const deletedFiles: string[] = [];
  const invalidFiles: string[] = [];
  let mode: "new" | "modified" | "deleted" | "invalid" | null = null;

  for (const arg of args) {
    if (arg === "--new") {
      mode = "new";
    } else if (arg === "--modified") {
      mode = "modified";
    } else if (arg === "--deleted") {
      mode = "deleted";
    } else if (arg === "--invalid") {
      mode = "invalid";
    } else if (arg.startsWith("projects/") || arg.startsWith("projects\\")) {
      if (mode === "modified") {
        modifiedFiles.push(arg);
      } else if (mode === "deleted") {
        deletedFiles.push(arg);
      } else if (mode === "invalid") {
        invalidFiles.push(arg);
      } else {
        newFiles.push(arg);
      }
    }
  }

  return { newFiles, modifiedFiles, deletedFiles, invalidFiles };
}

const { newFiles, modifiedFiles, deletedFiles, invalidFiles } = parseArgs(
  process.argv.slice(2),
);
const filesToValidate = [...newFiles, ...modifiedFiles];
const allChangedFiles = [...filesToValidate, ...deletedFiles, ...invalidFiles];

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
    const data = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as ProjectYaml | null;
    if (data?.repo) existingRepos.set(data.repo, file);
  } catch {
    // Skip unparseable files
  }
}

// Get base branch file content from git for addedAt comparison
function getBaseBranchContent(filePath: string): ProjectYaml | null {
  try {
    const baseBranch = process.env.GITHUB_BASE_REF || "main";
    const content = execSync(`git show origin/${baseBranch}:${filePath}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return yaml.load(content, { schema: yaml.JSON_SCHEMA }) as ProjectYaml | null;
  } catch {
    return null;
  }
}

function validateLinks(links: unknown, errors: string[]) {
  if (!Array.isArray(links)) {
    errors.push("`links` must be an array of HTTPS URLs");
    return;
  }
  if (links.length > MAX_LINKS) {
    errors.push(`\`links\` may have at most ${MAX_LINKS} items, got ${links.length}`);
  }
  const seen = new Set<string>();
  links.forEach((item: unknown, i: number) => {
    const prefix = `\`links[${i}]\``;
    if (typeof item !== "string") {
      errors.push(`${prefix} must be a string URL`);
      return;
    }
    if (seen.has(item)) {
      errors.push(`${prefix} duplicate URL \`${item}\``);
    }
    seen.add(item);
    try {
      const url = new URL(item);
      if (url.protocol !== "https:") errors.push(`${prefix} must use HTTPS`);
    } catch {
      errors.push(`${prefix} is not a valid URL: \`${item}\``);
    }
  });
}

let hasErrors = false;
const results: ValidationResult[] = [];

// Reject non-YAML files in projects/
for (const filePath of invalidFiles) {
  results.push({
    file: filePath,
    status: "deleted",
    errors: [
      `Only \`.yaml\` files are allowed in the \`projects/\` directory, got \`${filePath}\``,
    ],
  });
  hasErrors = true;
}

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
    const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });
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
  if (!data.submittedBy) errors.push("Missing required field: `submittedBy`");

  // repo format
  if (data.repo && !REPO_RE.test(data.repo)) {
    errors.push(`\`repo\` must match owner/repo format, got: \`${data.repo}\``);
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
      if (url.protocol !== "https:") errors.push("`banner` must use HTTPS");
    } catch {
      errors.push(`\`banner\` is not a valid URL: \`${data.banner}\``);
    }
  }

  // website must be https
  if (data.website != null) {
    try {
      const url = new URL(data.website);
      if (url.protocol !== "https:") errors.push("`website` must use HTTPS");
    } catch {
      errors.push(`\`website\` is not a valid URL: \`${data.website}\``);
    }
  }

  // links validation
  if (data.links != null) {
    validateLinks(data.links, errors);
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
    const filePath = filesToValidate.find((f) => basename(f) === result.file);
    if (!filePath) continue;
    const data = yaml.load(
      readFileSync(filePath, "utf8"),
    ) as ProjectYaml | null;
    if (!data?.repo) continue;

    try {
      const res = await fetch(`https://api.github.com/repos/${data.repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "AzGitCommunity-Showcase",
        },
      });
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
    status === "deleted"
      ? "[deleted]"
      : status === "new"
        ? "[new]"
        : "[modified]";
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
