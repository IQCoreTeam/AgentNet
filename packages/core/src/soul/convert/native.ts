// Soul → our own engines (plans/soul-memory-portability.md §6 step 6 — dogfood). The
// soul is per-wallet GLOBAL, so it rides each CLI's GLOBAL instruction file — Claude's
// ~/.claude/CLAUDE.md and Codex's $CODEX_HOME/AGENTS.md (both are read on every
// session, and the codex global + repo AGENTS.md concatenation is already verified in
// memory/convert/codex.ts) — as a fenced block, human content around it untouched.
// Inject-only: our engines edit the soul through soul_set (or a surface UI later),
// not by hand-editing the managed block.

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { claudeHome, codexHome } from "../../core/paths.js";
import { spliceMarkedBlock } from "../../memory/convert/codex.js";
import type { SoulStore } from "../store.js";

const START = "<!-- agentnet:soul:start -->";
const END = "<!-- agentnet:soul:end -->";

export function renderSoulBlock(text: string): string {
  const head = "# Soul (managed by AgentNet — the wallet's persona; edit via soul_set, not here)";
  return `${START}\n${head}\n\n${text.trimEnd()}\n${END}\n`;
}

/** The global instruction file the soul block lives in, per engine. */
export function soulFile(cli: "claude" | "codex"): string {
  return cli === "claude" ? join(claudeHome(), "CLAUDE.md") : join(codexHome(), "AGENTS.md");
}

export async function writeSoulBlock(file: string, soulText: string): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* no global instruction file yet */
  }
  await writeFile(file, spliceMarkedBlock(existing, renderSoulBlock(soulText), START, END));
}

/**
 * Inject the wallet's soul into an engine's global instruction file. No soul stored →
 * no-op (we never create an empty managed block); engine's home dir missing → no-op
 * (that engine isn't set up on this machine — don't invent its config dir). Returns
 * whether a block was written.
 */
export async function injectSoulNative(cli: "claude" | "codex", store: SoulStore): Promise<boolean> {
  const home = cli === "claude" ? claudeHome() : codexHome();
  if (!(await access(home).then(() => true).catch(() => false))) return false;
  const doc = await store.load();
  if (!doc) return false;
  await writeSoulBlock(soulFile(cli), doc.text);
  return true;
}
