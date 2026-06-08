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

/** Ensure a directory exists (mkdir -p). Call before writing into it. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
