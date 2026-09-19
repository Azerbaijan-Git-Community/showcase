import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as yaml from "js-yaml";

type ProjectYaml = {
  repo?: string;
  submittedBy?: string;
  banner?: string;
  website?: string;
  links?: unknown;
};

type Project = {
  file: string;
  repo: string;
  submittedBy?: string;
  banner?: string;
  website?: string;
};

/** Run a git command and return its output lines (forward-slashed), or [] on empty. */
function gitLines(args: string): string[] {
  const out = execSync(`git ${args}`, { encoding: "utf8" }).trim();
  return out ? out.split("\n").map((f) => f.replaceAll("\\", "/")) : [];
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

/**
 * Project files added in this push. Diffs the push range (`BEFORE..AFTER`) when
 * a usable `before` commit is present, otherwise falls back to the head commit's
 * first parent (covers `workflow_dispatch` and the first push to a branch).
 */
function addedProjectFiles(): string[] {
  const before = process.env.BEFORE?.trim();
  const after = process.env.AFTER?.trim() || "HEAD";

  const hasBefore =
    !!before &&
    before !== ZERO_SHA &&
    (() => {
      try {
        execSync(`git rev-parse ${before}`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

  const range = hasBefore ? `${before} ${after}` : `${after}~1 ${after}`;
  try {
    return gitLines(`diff --name-only --diff-filter=A ${range} -- projects/`).filter((f) => f.endsWith(".yaml"));
  } catch {
    // Root commit with no parent, or git failure: nothing to announce.
    return [];
  }
}

function readProject(file: string): Project | null {
  try {
    const data = yaml.load(readFileSync(file, "utf8"), { schema: yaml.JSON_SCHEMA }) as ProjectYaml | null;
    if (!data?.repo) return null;
    return { file, repo: data.repo, submittedBy: data.submittedBy, banner: data.banner, website: data.website };
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Telegram HTML-mode caption for a newly showcased project. */
function buildCaption(project: Project): string {
  const repoUrl = `https://github.com/${project.repo}`;
  const lines = [`🚀 New project added: <b>${escapeHtml(project.repo)}</b>`, ""];
  if (project.submittedBy) lines.push(`👤 Submitted by <b>${escapeHtml(project.submittedBy)}</b>`);
  lines.push(`🔗 <a href="${encodeURI(repoUrl)}">GitHub repository</a>`);
  const showcaseUrl = process.env.WEBSITE_URL?.trim();
  if (showcaseUrl) lines.push(`✨ <a href="${encodeURI(`${showcaseUrl}/showcase`)}">View on the showcase</a>`);
  if (project.website) lines.push(`🌐 <a href="${encodeURI(project.website)}">Website</a>`);
  return lines.join("\n");
}

type TelegramResult = { ok: boolean; description?: string };

async function callTelegram(token: string, method: string, payload: Record<string, unknown>): Promise<TelegramResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as TelegramResult;
  } catch (e) {
    return { ok: false, description: (e as Error).message };
  }
}

/**
 * Announce one project. Prefers `sendPhoto` with the banner; if Telegram cannot
 * fetch the image (bad/blocked URL), it falls back to a plain `sendMessage` so
 * the announcement still goes out. Returns whether something was sent.
 */
async function announce(
  token: string,
  chatId: string,
  threadId: string | undefined,
  project: Project,
): Promise<boolean> {
  const caption = buildCaption(project);
  const base: Record<string, unknown> = { chat_id: chatId, parse_mode: "HTML" };
  if (threadId) base.message_thread_id = Number(threadId);

  if (project.banner) {
    const photo = await callTelegram(token, "sendPhoto", { ...base, photo: project.banner, caption });
    if (photo.ok) return true;
    console.warn(`  sendPhoto failed for ${project.repo} (${photo.description}), falling back to text`);
  }

  const message = await callTelegram(token, "sendMessage", {
    ...base,
    text: caption,
    link_preview_options: { is_disabled: false },
  });
  if (!message.ok) {
    console.error(`  Failed to announce ${project.repo}: ${message.description}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const threadId = process.env.TELEGRAM_TOPIC_ID?.trim() || undefined;

  if (!token || !chatId) {
    console.error("Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set.");
    process.exit(1);
  }

  const files = addedProjectFiles();
  if (files.length === 0) {
    console.log("No newly added project files in this push, nothing to announce.");
    return;
  }

  const projects = files.map(readProject).filter((p): p is Project => p !== null);
  console.log(`Announcing ${projects.length} new project(s): ${projects.map((p) => basename(p.file)).join(", ")}`);

  let failed = 0;
  for (const project of projects) {
    const sent = await announce(token, chatId, threadId, project);
    if (!sent) failed++;
    // Stay well under Telegram's per-group rate limit when several land at once.
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (failed > 0) {
    process.exit(1);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
