#!/usr/bin/env node
// Pre-PR check script for the showcase registry
// Run before opening a PR:
//   pnpm checks
//
// Checks: Prettier format · YAML validation (all projects/)
import { execSync } from "child_process";
import { readdirSync } from "fs";
import { join } from "path";
import * as readline from "readline";

type Check = {
  name: string;
  cmd: string;
  onFail?: string;
};

// ── Colors ────────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

// ── Prompt helper ─────────────────────────────────────────────────
function ask(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== "n");
    });
  });
}

// ── Detect git status of project files ───────────────────────────
function getGitChanges(): { newFiles: string[]; modifiedFiles: string[]; deletedFiles: string[]; invalidFiles: string[] } {
  try {
    // Staged + unstaged changes against HEAD
    const staged = execSync("git diff --name-only --diff-filter=A --cached -- projects/", { encoding: "utf8" }).trim();
    const stagedM = execSync("git diff --name-only --diff-filter=CMRT --cached -- projects/", { encoding: "utf8" }).trim();
    const stagedD = execSync("git diff --name-only --diff-filter=D --cached -- projects/", { encoding: "utf8" }).trim();
    const unstaged = execSync("git diff --name-only --diff-filter=CMRT -- projects/", { encoding: "utf8" }).trim();
    const untracked = execSync("git ls-files --others --exclude-standard -- projects/", { encoding: "utf8" }).trim();

    const toList = (s: string) => s ? s.split("\n").map((f) => f.replaceAll("\\", "/")) : [];

    const newFiles = [...new Set([...toList(staged), ...toList(untracked)])].filter((f) => f.endsWith(".yaml"));
    const modifiedFiles = [...new Set([...toList(stagedM), ...toList(unstaged)])].filter((f) => f.endsWith(".yaml"));
    const deletedFiles = toList(stagedD).filter((f) => f.endsWith(".yaml"));
    const invalidFiles = [
      ...toList(staged), ...toList(stagedM), ...toList(untracked),
    ].filter((f) => !f.endsWith(".yaml") && f.startsWith("projects/"));

    return { newFiles, modifiedFiles, deletedFiles, invalidFiles };
  } catch {
    // Not a git repo or no changes — fall back to all files as modified
    const all = readdirSync("projects")
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => join("projects", f).replaceAll("\\", "/"));
    return { newFiles: [], modifiedFiles: all, deletedFiles: [], invalidFiles: [] };
  }
}

const { newFiles, modifiedFiles, deletedFiles, invalidFiles } = getGitChanges();

const validateArgs = [
  newFiles.length ? `--new ${newFiles.join(" ")}` : "",
  modifiedFiles.length ? `--modified ${modifiedFiles.join(" ")}` : "",
  deletedFiles.length ? `--deleted ${deletedFiles.join(" ")}` : "",
  invalidFiles.length ? `--invalid ${invalidFiles.join(" ")}` : "",
].filter(Boolean).join(" ");

const hasChanges = newFiles.length + modifiedFiles.length + deletedFiles.length + invalidFiles.length > 0;

// ── Checks ────────────────────────────────────────────────────────
const checks: Check[] = [
  {
    name: "Prettier — format check",
    cmd: "pnpm prettier --check projects/",
    onFail: "pnpm prettier --write projects/",
  },
  {
    name: "TypeScript — type check",
    cmd: "pnpm tsc --noEmit",
  },
  ...(hasChanges
    ? [
        {
          name: "YAML — validate changed projects",
          cmd: `pnpm exec tsx .github/scripts/validate.ts ${validateArgs}`,
        },
      ]
    : []),
];

// ── Runner ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

console.log(`\n${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}${CYAN}   Pre-PR Checks — Azerbaijan GitHub Community Showcase${RESET}`);
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}\n`);

for (const check of checks) {
  console.log(`${BOLD}${YELLOW}▶ ${check.name}${RESET}`);
  console.log(`  ${CYAN}$ ${check.cmd}${RESET}\n`);

  let errorOutput = "";

  try {
    const result = execSync(check.cmd, {
      encoding: "utf8",
      stdio: ["inherit", "inherit", "pipe"],
    });
    if (result) process.stdout.write(result);
    console.log(`\n${GREEN}✔ PASSED: ${check.name}${RESET}\n`);
    passed++;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stderr" in err) {
      errorOutput = String((err as { stderr: string }).stderr ?? "");
    }
    if (errorOutput) process.stderr.write(errorOutput);

    console.log(`\n${RED}✖ FAILED: ${check.name}${RESET}`);

    if (check.onFail) {
      console.log(`\n${YELLOW}  Some files are not formatted correctly.${RESET}`);

      const confirm = await ask(
        `${YELLOW}${BOLD}  Run "${check.onFail}" to auto-fix? [Enter = yes / n = skip]: ${RESET}`,
      );

      if (confirm) {
        try {
          console.log(`\n  ${CYAN}$ ${check.onFail}${RESET}\n`);
          execSync(check.onFail, { stdio: "inherit" });
          console.log(`\n${GREEN}✔ Auto-fixed: ${check.name}${RESET}\n`);
          passed++;
          console.log(`${CYAN}──────────────────────────────────────────────────${RESET}\n`);
          continue;
        } catch {
          console.log(`\n${RED}  Auto-fix failed. Please fix manually.${RESET}`);
        }
      } else {
        console.log(`${YELLOW}  Skipped auto-fix.${RESET}`);
      }
    }

    console.log();
    failed++;
    failures.push(check.name);
  }

  console.log(`${CYAN}──────────────────────────────────────────────────${RESET}\n`);
}

// ── Summary ───────────────────────────────────────────────────────
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}`);
console.log(
  `${BOLD}   Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`,
);

if (failures.length > 0) {
  console.log(`\n${RED}${BOLD}Failed checks:${RESET}`);
  failures.forEach((name) => console.log(`  ${RED}• ${name}${RESET}`));
  console.log(`\n${RED}${BOLD}⚠  Fix the issues above before opening a PR.${RESET}\n`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}${BOLD}✔  All checks passed. Ready to open a PR!${RESET}\n`);
  process.exit(0);
}
