// Login / initialize flow — the first thing a surface (vscode/CLI) calls.
//
//   first run:  connect wallet → pick a storage backend → (gdrive: Google sign-in;
//               icloud/custom: a path/URL) → save choice to config.json.
//   later runs: read config.json → rebuild the same storage (gdrive refreshes its
//               token silently). If nothing is configured yet, isInitialized() is false
//               and the UI shows the picker.
//
// We persist ONLY the non-secret choice (kind + path) in config.json; OAuth tokens
// live separately (oauth.ts → tokens/google.json). Our server stores nothing.

import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { configFile, tokenFile, rootDir, ensureDir, sessionsDir } from "../core/paths.js";
import { deleteCodexApiKey } from "./codexAuth.js";
import type { KeyPolicy, KeyVault } from "./keyPolicy.js";
import { buildStorage, type StorageConfig, type StorageKind } from "./storage/adapter.js";
import { manualStorage, migrateLocalSessions } from "./storage/manual.js";
import { mirrorStorage, type CloudStatus } from "./storage/mirror.js";
import { migrateLegacyDriveSessions } from "./storage/gdrive.js";
import { googleLogin, isSignedIn, googleAccount } from "./storage/oauth.js";
import type { StorageAdapter, Wallet } from "../runtime/contract.js";

export interface Session {
  wallet: Wallet;
  storage: StorageAdapter;
}

async function readConfig(): Promise<StorageConfig | null> {
  try {
    return JSON.parse(await readFile(configFile(), "utf8")) as StorageConfig;
  } catch {
    return null;
  }
}

// google_client_id/secret are APP creds, not part of the storage choice — they live
// in the same config.json but must survive a connect/disconnect cycle. Read them raw
// (StorageConfig doesn't type them) so we can preserve them across writes.
async function readRawConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(configFile(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeConfig(cfg: StorageConfig): Promise<void> {
  await ensureDir(rootDir());
  const prev = await readRawConfig();
  // keep the OAuth client creds; overwrite the storage fields with the new choice.
  const merged = {
    ...cfg,
    google_client_id: prev.google_client_id,
    google_client_secret: prev.google_client_secret,
  };
  await writeFile(configFile(), JSON.stringify(merged, null, 2));
}

/** True once a storage backend has been chosen on this device. */
export async function isInitialized(): Promise<boolean> {
  return (await readConfig())?.kind != null;
}

// Passive skill-shopping toggle (issue #21). Lives in the same config.json as the
// storage choice, but is NOT part of StorageConfig — so we read/write it raw and
// preserve everything else (storage fields + google creds) across writes. Default ON:
// absent flag → true; only an explicit `false` turns it off.
export async function getSkillShopping(): Promise<boolean> {
  const raw = await readRawConfig();
  return raw.skillShopping !== false;
}

export async function setSkillShopping(on: boolean): Promise<void> {
  await ensureDir(rootDir());
  const prev = await readRawConfig();
  await writeFile(configFile(), JSON.stringify({ ...prev, skillShopping: on }, null, 2));
}

// First-run setup: record the chosen backend and (for gdrive) run Google sign-in.
// `openBrowser` is injected by the surface (only used for gdrive).
export async function initialize(
  cfg: StorageConfig,
  openBrowser?: (url: string) => void,
): Promise<void> {
  if (cfg.kind === "gdrive" && !(await isSignedIn())) {
    if (!openBrowser) throw new Error("gdrive needs an openBrowser callback for sign-in");
    await googleLogin(openBrowser);
  }
  await writeConfig(cfg);
}

// Bind the wallet to storage. Local is ALWAYS on; a cloud backend mirrors it if
// one was configured (config present). No cloud chosen yet → local-only, no error
// (the "maybe later" path). Returns a MirrorStorage so the runtime is unchanged.
export async function login(
  wallet: Wallet,
  onCloudStatus?: (s: CloudStatus) => void,
): Promise<Session> {
  const addr = wallet.address;
  // sessions live under the wallet's folder (per-agent). Migrate any pre-wallet-folder
  // sessions into it once, best-effort.
  await migrateLocalSessions(addr).catch(() => {});
  const local = manualStorage(addr);

  const cfg = await readConfig();
  // A config with creds but no storage kind (after disconnect) is NOT a cloud choice.
  const cloud = cfg?.kind ? await buildStorage(cfg, addr) : undefined;
  if (cfg?.kind === "gdrive") {
    void migrateLegacyDriveSessions(addr).catch(() => {}); // move old flat-folder files
  }
  return { wallet, storage: mirrorStorage(local, cloud, onCloudStatus) };
}

// True if a CLOUD backend is connected (local is always on regardless). A config
// holding only OAuth creds (no kind) is NOT a connection.
export async function isCloudConnected(): Promise<boolean> {
  return !!(await readConfig())?.kind;
}

// Which backend is configured right now (for the UI to show "Saving to: Google Drive").
export async function currentStorageKind(): Promise<StorageKind | null> {
  return (await readConfig())?.kind ?? null;
}

// Full "my storage" info for the settings panel: which backend, where, and (for
// gdrive) whether a token is present on this device. null = not initialized yet.
export interface StorageInfo {
  kind: StorageKind;
  location?: string; // folder (icloud) or base URL (custom); undefined for gdrive/local
  connected: boolean; // gdrive: has a local token; others: always true once configured
  account?: string;   // gdrive: the signed-in Google account (email), for display
}

export async function getStorageInfo(): Promise<StorageInfo | null> {
  const cfg = await readConfig();
  if (!cfg) return null;
  const connected = cfg.kind === "gdrive" ? await isSignedIn() : true;
  const account = cfg.kind === "gdrive" && connected ? (await googleAccount()) ?? undefined : undefined;
  return { kind: cfg.kind, location: cfg.location, connected, account };
}

// Change the storage backend later (the "use a different cloud?" UI). Same as
// initialize, but named for intent. Re-binds: returns a fresh Session on the new
// backend. Existing sessions stay on the old one (no migration here).
export async function switchStorage(
  wallet: Wallet,
  cfg: StorageConfig,
  openBrowser?: (url: string) => void,
): Promise<Session> {
  await initialize(cfg, openBrowser);
  return login(wallet);
}

// Turn the cloud mirror OFF: forget the cloud CHOICE + OAuth token on THIS device.
// Local sessions stay (login() falls back to local-only). The OAuth client creds
// (google_client_id/secret) are PRESERVED — they're app config, not a connection —
// so reconnecting later can still start the sign-in flow. (Deleting them is exactly
// what made "connect" do nothing: clientId() threw and the popup never opened.)
export async function disconnectCloud(): Promise<void> {
  const raw = await readRawConfig();
  await rm(tokenFile("google"), { force: true });
  // drop the storage choice but keep the creds, if any were set
  if (raw.google_client_id || raw.google_client_secret) {
    await ensureDir(rootDir());
    await writeFile(
      configFile(),
      JSON.stringify(
        { google_client_id: raw.google_client_id, google_client_secret: raw.google_client_secret },
        null,
        2,
      ),
    );
  } else {
    await rm(configFile(), { force: true });
  }
}

/** "soft": drop in-memory state + cloud binding (default). "full": soft + wipe this wallet's local data. */
export type LogoutPolicy = "soft" | "full";

/**
 * Unified logout. Soft = forget cloud binding + in-memory session key. Full = soft +
 * delete this wallet's local session logs and cached Codex API key.
 *
 * Always KEEP: keypair file, installed skills, claude/codex own home dirs, cli-map.
 * Pass `address` when policy is "full" (the wallet's base58 address).
 * Pass `keyPolicy` to also clear its cached session key (and vault if address is provided).
 */
export async function logout(opts: {
  policy?: LogoutPolicy;
  address?: string;
  keyPolicy?: KeyPolicy;
} = {}): Promise<void> {
  const { policy = "soft", address, keyPolicy } = opts;

  await disconnectCloud();

  if (policy === "full") {
    if (keyPolicy) {
      await keyPolicy.clear(address);
    }
    if (address) {
      await rm(join(sessionsDir(), address), { recursive: true, force: true });
    }
    await deleteCodexApiKey();
  } else {
    if (keyPolicy) {
      await keyPolicy.clear();
    }
  }
}

/** Save Google OAuth app credentials without touching the storage kind. */
export async function saveGoogleCreds(clientId: string, clientSecret: string): Promise<void> {
  await ensureDir(rootDir());
  const prev = await readRawConfig();
  await writeFile(
    configFile(),
    JSON.stringify({ ...prev, google_client_id: clientId, google_client_secret: clientSecret }, null, 2),
  );
}

/** True if Google OAuth app credentials are present in config. */
export async function hasGoogleCreds(): Promise<boolean> {
  const raw = await readRawConfig();
  return !!(raw.google_client_id);
}
