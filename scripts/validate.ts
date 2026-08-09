import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import yaml from "js-yaml";

type ProjectYaml = {
  repo?: string;
  submittedBy?: string;
  banner?: string;
  links?: unknown;
  website?: string;
  [key: string]: unknown;
};

type ValidationResult = {
  file: string;
  status: "new" | "modified" | "deleted";
  errors: string[];
};

type Changes = {
  newFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  invalidFiles: string[];
  misplacedFiles: string[];
};

const REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

// Domains that belong in `links`, not `website`
const REGISTRY_DOMAINS = new Set([
  "npmjs.com",
  "pypi.org",
  "marketplace.visualstudio.com",
  "open-vsx.org",
  "crates.io",
  "rubygems.org",
  "nuget.org",
  "hub.docker.com",
  "pub.dev",
  "pkg.go.dev",
  "hex.pm",
  "packagist.org",
  "anaconda.org",
  "mvnrepository.com",
  "cocoapods.org",
  "jsr.io",
  "plugins.jetbrains.com",
  "chromewebstore.google.com",
  "addons.mozilla.org",
  "aur.archlinux.org",
  "snapcraft.io",
  "flathub.org",
  "search.nixos.org",
  "formulae.brew.sh",
  "ghcr.io",
]);

const ALLOWED_FIELDS = new Set(["repo", "submittedBy", "banner", "links", "website"]);

// YAML files that legitimately live outside `projects/` (repo config, not submissions).
const CONFIG_YAML = new Set(["pnpm-lock.yaml", "pnpm-workspace.yaml"]);

/** True for a YAML file that is neither a project submission nor known repo config. */
function isMisplacedYaml(file: string): boolean {
  if (!file.endsWith(".yaml") && !file.endsWith(".yml")) return false;
  if (file.startsWith("projects/")) return false;
  if (file.startsWith(".github/")) return false;
  return !CONFIG_YAML.has(basename(file));
}

const MAX_LINKS = 5;

/** Run a git command and return its output lines (forward-slashed), or [] on empty. */
function gitLines(args: string): string[] {
  const out = execSync(`git ${args}`, { encoding: "utf8" }).trim();
  return out ? out.split("\n").map((f) => f.replaceAll("\\", "/")) : [];
}

/**
 * Detect the changed project files. In CI (pull_request) it diffs against the
 * base branch; locally it diffs the working tree (staged + unstaged + untracked)
 * against HEAD. Falls back to validating every project file if git is unavailable.
 */
function detectChanges(): Changes {
  const yamlOnly = (list: string[]) => list.filter((f) => f.endsWith(".yaml"));
  const nonYamlInProjects = (list: string[]) => list.filter((f) => f.startsWith("projects/") && !f.endsWith(".yaml"));

  try {
    const base = process.env.GITHUB_BASE_REF;
    if (base) {
      const range = `origin/${base}...HEAD`;
      return {
        newFiles: yamlOnly(gitLines(`diff --name-only --diff-filter=A ${range} -- projects/`)),
        modifiedFiles: yamlOnly(gitLines(`diff --name-only --diff-filter=CMRT ${range} -- projects/`)),
        deletedFiles: yamlOnly(gitLines(`diff --name-only --diff-filter=D ${range} -- projects/`)),
        invalidFiles: nonYamlInProjects(gitLines(`diff --name-only --diff-filter=ACMRT ${range} -- projects/`)),
        misplacedFiles: gitLines(`diff --name-only --diff-filter=ACMRT ${range}`).filter(isMisplacedYaml),
      };
    }

    const stagedNew = gitLines("diff --name-only --diff-filter=A --cached -- projects/");
    const stagedMod = gitLines("diff --name-only --diff-filter=CMRT --cached -- projects/");
    const stagedDel = gitLines("diff --name-only --diff-filter=D --cached -- projects/");
    const unstagedMod = gitLines("diff --name-only --diff-filter=CMRT -- projects/");
    const untracked = gitLines("ls-files --others --exclude-standard -- projects/");

    const stagedAll = gitLines("diff --name-only --diff-filter=ACMRT --cached");
    const unstagedAll = gitLines("diff --name-only --diff-filter=ACMRT");
    const untrackedAll = gitLines("ls-files --others --exclude-standard");

    return {
      newFiles: yamlOnly([...new Set([...stagedNew, ...untracked])]),
      modifiedFiles: yamlOnly([...new Set([...stagedMod, ...unstagedMod])]),
      deletedFiles: yamlOnly(stagedDel),
      invalidFiles: nonYamlInProjects([...new Set([...stagedNew, ...stagedMod, ...untracked])]),
      misplacedFiles: [...new Set([...stagedAll, ...unstagedAll, ...untrackedAll])].filter(isMisplacedYaml),
    };
  } catch {
    // Not a git repo or git failed: validate every project file.
    const all = readdirSync("projects")
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => join("projects", f).replaceAll("\\", "/"));
    return { newFiles: [], modifiedFiles: all, deletedFiles: [], invalidFiles: [], misplacedFiles: [] };
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

/**
 * Validate changed project registry files. Detects the changes itself, prints a
 * per-file report, and throws when any file is invalid (which fails the check).
 */
export async function validate(): Promise<void> {
  const { newFiles, modifiedFiles, deletedFiles, invalidFiles, misplacedFiles } = detectChanges();
  const filesToValidate = [...newFiles, ...modifiedFiles];
  const allChangedFiles = [...filesToValidate, ...deletedFiles, ...invalidFiles, ...misplacedFiles];

  if (allChangedFiles.length === 0) {
    console.log("No changed project files to validate.");
    return;
  }

  const modifiedSet = new Set(modifiedFiles);

  // Load all existing repos for duplicate checking (from the working tree).
  const allProjectFiles = readdirSync("projects").filter((f) => f.endsWith(".yaml"));
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

  let hasErrors = false;
  const results: ValidationResult[] = [];

  // Reject project YAML files placed outside the `projects/` directory.
  for (const filePath of misplacedFiles) {
    results.push({
      file: filePath,
      status: "new",
      errors: [`Project files must live in the \`projects/\` directory, move \`${filePath}\` into \`projects/\``],
    });
    hasErrors = true;
  }

  // Reject non-YAML files in projects/
  for (const filePath of invalidFiles) {
    results.push({
      file: filePath,
      status: "deleted",
      errors: [`Only \`.yaml\` files are allowed in the \`projects/\` directory, got \`${filePath}\``],
    });
    hasErrors = true;
  }

  // Validate deleted files: just confirm they are gone, no field checks.
  for (const filePath of deletedFiles) {
    const filename = basename(filePath);
    if (existsSync(filePath)) {
      results.push({
        file: filename,
        status: "deleted",
        errors: ["File is marked as deleted but still exists in the working tree"],
      });
      hasErrors = true;
    } else {
      results.push({ file: filename, status: "deleted", errors: [] });
    }
  }

  // Validate new and modified files.
  for (const filePath of filesToValidate) {
    const errors: string[] = [];
    const filename = basename(filePath);
    const status = modifiedSet.has(filePath) ? "modified" : "new";

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

    // Unknown fields
    for (const key of Object.keys(data)) {
      if (!ALLOWED_FIELDS.has(key)) {
        errors.push(`Unknown field \`${key}\`, only allowed: ${[...ALLOWED_FIELDS].join(", ")}`);
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
        errors.push(`Filename must be \`${expectedFilename}\` for repo \`${data.repo}\`, got \`${filename}\``);
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

    // website must be https, not a registry domain, and not duplicated in links
    if (data.website != null) {
      try {
        const url = new URL(data.website);
        if (url.protocol !== "https:") {
          errors.push("`website` must use HTTPS");
        } else {
          const hostname = url.hostname.replace(/^www\./, "");
          if (REGISTRY_DOMAINS.has(hostname)) {
            errors.push(
              `\`website\` must be the project's own website or docs, \`${url.hostname}\` belongs in \`links\` instead`,
            );
          }
          if (Array.isArray(data.links) && data.links.includes(data.website)) {
            errors.push("`website` URL is already listed in `links`, remove the duplicate");
          }
        }
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
        errors.push(`Repo \`${data.repo}\` already exists in \`${existingFile}\``);
      }
    }

    if (errors.length > 0) hasErrors = true;
    results.push({ file: filename, status, errors });
  }

  // Check repos exist and are public on GitHub (only for new/modified without errors).
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    for (const result of results) {
      if (result.errors.length > 0 || result.status === "deleted") continue;
      const filePath = filesToValidate.find((f) => basename(f) === result.file);
      if (!filePath) continue;
      const data = yaml.load(readFileSync(filePath, "utf8")) as ProjectYaml | null;
      if (!data?.repo) continue;

      try {
        const res = await fetch(`https://api.github.com/repos/${data.repo}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "AzGitCommunity-Showcase",
          },
        });
        if (res.status === 404) {
          result.errors.push(`Repository \`${data.repo}\` does not exist or is not public on GitHub`);
          hasErrors = true;
        } else if (res.ok) {
          const repoData = (await res.json()) as { private: boolean };
          if (repoData.private) {
            result.errors.push(`Repository \`${data.repo}\` is private, only public repos are allowed`);
            hasErrors = true;
          }
        }
      } catch {
        // Network error: skip check, do not fail the PR for this.
      }
    }
  }

  // Report
  console.log("");
  for (const { file, status, errors } of results) {
    const tag = status === "deleted" ? "[deleted]" : status === "new" ? "[new]" : "[modified]";
    if (errors.length === 0) {
      console.log(`  ${tag} ${file}: valid`);
    } else {
      console.log(`  ${tag} ${file}:`);
      for (const err of errors) {
        console.log(`    - ${err}`);
      }
    }
  }
  console.log("");

  if (hasErrors) {
    throw new Error("Project validation failed. See the issues listed above.");
  }
  console.log("All files valid.");
}
