import { appendFileSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { checkRepoStatus, resolveGitHubToken } from "./validate.ts";

type ProjectYaml = { repo?: string };

type Removal = { file: string; repo: string; reason: "missing" | "private" };

const REASON_LABEL: Record<Removal["reason"], string> = {
  missing: "deleted or no longer public on GitHub (404)",
  private: "flipped to private",
};

/** Read every `projects/*.yaml`, returning `{ file, repo }` for the parseable ones. */
function readProjects(): Array<{ file: string; repo: string }> {
  return readdirSync("projects")
    .filter((f) => f.endsWith(".yaml"))
    .map((file) => {
      try {
        const data = yaml.load(readFileSync(join("projects", file), "utf8"), {
          schema: yaml.JSON_SCHEMA,
        }) as ProjectYaml | null;
        return data?.repo ? { file, repo: data.repo } : null;
      } catch {
        return null;
      }
    })
    .filter((p): p is { file: string; repo: string } => p !== null);
}

/** Build the markdown body used for the PR / job summary. */
function buildReport(removals: Removal[]): string {
  const lines = ["The following projects were removed because their GitHub repository is gone or private:", ""];
  for (const { file, repo, reason } of removals) {
    lines.push(`- \`${file}\` — [\`${repo}\`](https://github.com/${repo}) — ${REASON_LABEL[reason]}`);
  }
  lines.push("", "Please review and merge to drop them from the showcase, or close this PR if it looks wrong.");
  return lines.join("\n");
}

/** Expose results to the workflow via $GITHUB_OUTPUT. Always writes `count`. */
function writeGitHubOutput(removals: Removal[], report: string | null): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  appendFileSync(out, `count=${removals.length}\n`);
  if (report !== null) {
    const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
    appendFileSync(out, `body<<${delimiter}\n${report}\n${delimiter}\n`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const token = resolveGitHubToken();
  if (!token) {
    console.error("Error: no GitHub credentials found. Set GITHUB_TOKEN or run `gh auth login`.");
    process.exit(1);
  }

  const projects = readProjects();
  if (projects.length === 0) {
    console.log("No projects found, nothing to remove.");
    writeGitHubOutput([], null);
    return;
  }

  const statuses = await Promise.all(projects.map((p) => checkRepoStatus(p.repo, token)));

  const removals: Removal[] = [];
  let unknown = 0;
  projects.forEach((p, i) => {
    const status = statuses[i];
    if (status === "missing" || status === "private") {
      removals.push({ file: p.file, repo: p.repo, reason: status });
    } else if (status === "unknown") {
      unknown++;
      console.warn(`  ? ${p.repo}: status could not be determined, leaving it alone`);
    }
  });

  // Every project flagged means a token/API problem, not a real mass deletion.
  if (removals.length > 0 && removals.length === projects.length) {
    console.error(
      `Refusing to remove: all ${projects.length} projects came back missing/private, ` +
        "which almost certainly means a credential or API problem, not a real mass deletion.",
    );
    process.exit(1);
  }

  if (removals.length === 0) {
    console.log(`All ${projects.length} projects are live and public${unknown ? ` (${unknown} indeterminate)` : ""}.`);
    writeGitHubOutput([], null);
    return;
  }

  const report = buildReport(removals);
  console.log(`\n${report}\n`);

  if (dryRun) {
    console.log("Dry run: no files deleted.");
  } else {
    for (const { file } of removals) {
      unlinkSync(join("projects", file));
    }
    console.log(`Deleted ${removals.length} project file(s).`);
  }

  writeGitHubOutput(removals, report);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
