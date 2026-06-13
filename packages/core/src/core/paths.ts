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

/** Ensure a directory exists (mkdir -p). Call before writing into it. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
