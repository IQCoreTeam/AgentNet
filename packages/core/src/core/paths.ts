// Single source of truth for every local path AgentNet writes on a device.
// Nothing else hard-codes a path or reads ~/.agentnet directly — call these.
// Layout (all under one root so it's easy to find, back up, or wipe):
//
//   ~/.agentnet/                        ROOT  (override with AGENTNET_HOME)
//   ├── config.json                     which storage backend + non-secret config
//   ├── tokens/<provider>.json          OAuth tokens, PER DEVICE, local only (gitignored intent)
//   ├── sessions/<sessionId>.bin        local session logs (local backend / cache)
//   └── git/                            repos/data WE manage on this device
//
// Why files, not just env: a fixed, named layout means a token or session is always
// findable the same way on every device. AGENTNET_HOME lets tests / multi-account
// point elsewhere without touching code.

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

/** Root dir for all AgentNet local state. Override: AGENTNET_HOME. */
export function rootDir(): string {
  return process.env.AGENTNET_HOME || join(homedir(), ".agentnet");
}

export function configFile(): string {
  return join(rootDir(), "config.json");
}

/** OAuth token file for a provider (e.g. "google"). Per device, never synced/committed. */
export function tokenFile(provider: string): string {
  return join(rootDir(), "tokens", `${provider}.json`);
}

export function tokensDir(): string {
  return join(rootDir(), "tokens");
}

/** Local session-log dir (local backend, or a cache for cloud backends). */
export function sessionsDir(): string {
  return join(rootDir(), "sessions");
}

/** Dir for git repos / data AgentNet manages on this device. */
export function gitDir(): string {
  return join(rootDir(), "git");
}

/** canonicalId -> per-CLI native id map (resume injection). Local, never synced. */
export function cliMapFile(): string {
  return join(rootDir(), "cli-map.json");
}

/** Device identity file. Local, never synced. */
export function deviceFile(): string {
  return join(rootDir(), "device.json");
}

// ── the CLIs' own homes (we inject native session files INTO these) ──
// Cross-CLI resume rewrites a canonical session into claude/codex's native
// jsonl at the exact path that CLI reads, so `--resume` continues it.

/** Claude Code config home. Override: CLAUDE_CONFIG_DIR. */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** Claude stores a session per cwd: projects/{cwd with "/" -> "-"}/{uuid}.jsonl */
export function claudeProjectDir(cwd: string): string {
  return join(claudeHome(), "projects", cwd.replaceAll("/", "-"));
}

/** Codex config home. Override: CODEX_HOME. */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/** Codex stores sessions under sessions/YYYY/MM/DD/rollout-<iso>-<threadId>.jsonl */
export function codexSessionsDir(): string {
  return join(codexHome(), "sessions");
}

// ── shared memory (issue #18): the per-runtime memory files we sync ⇄ canonical ──
// Claude keeps discrete frontmatter records under its per-project memory dir; stock
// Codex reads a plain-markdown AGENTS.md at the repo root (verified: it never writes
// memory itself, so Codex is inject-only). See plans/shared-memory.md.

/** Claude per-project auto-memory dir: projects/{cwd "/"->"-"}/memory */
export function claudeMemoryDir(cwd: string): string {
  return join(claudeProjectDir(cwd), "memory");
}

/** Codex's repo-level memory file (AGENTS.md at the session cwd). */
export function codexAgentsFile(cwd: string): string {
  return join(cwd, "AGENTS.md");
}

// ── active skills (issue #17): where we drop a bought skill's SKILL.md so the CLI
// discovers it. Both runtimes scan a skills dir and read each skill's frontmatter
// (name + description) at session start, loading the body only on demand — pure
// filesystem placement, no registry (verified against last30days-skill, see
// plans/skill-ingestion.md §8a). We write the same minimal shape from an NFT's text.

/** Claude Code user skills dir; a skill lives at {dir}/{name}/SKILL.md. */
export function claudeSkillsDir(): string {
  return join(claudeHome(), "skills");
}

/** Codex user skills dir ($CODEX_HOME/skills); a skill lives at {dir}/{name}/SKILL.md. */
export function codexSkillsDir(): string {
  return join(codexHome(), "skills");
}

// ── inactive skills (skill-shopping toggle, plans/skill-shopping.md §6): a holding
// dir OUTSIDE every runtime's scanned skills path. Toggling a bundled skill OFF moves
// its folder here (never deletes it); toggling ON moves it back to the scanned dir. The
// CLI never scans here, so an OFF skill is simply not discovered — no frontmatter flag
// needed (codex ignores `disable-model-invocation`, so file-move is the one mechanism
// that works for both engines). One dir under our root, per scanned source.

/** Holding dir for a runtime's switched-OFF bundled skills (mirrors {cli}SkillsDir). */
export function inactiveSkillsDir(cli: "claude" | "codex"): string {
  return join(rootDir(), "inactive-skills", cli);
}

/** Skill-origin manifest (slug → NFT mint). A SKILL.md on disk is identical whatever its
 *  source, so origin can't be read from the file — this side record is the source of truth
 *  for "this installed skill was bought as an NFT". Local, never synced. See
 *  skill-market/registry.ts. */
export function skillsManifestFile(): string {
  return join(rootDir(), "skills.json");
}

/** Ensure a directory exists (mkdir -p) with 0o700 so only the owner can enter. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}
