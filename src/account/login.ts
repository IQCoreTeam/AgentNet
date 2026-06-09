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
import { configFile, tokenFile, rootDir, ensureDir } from "../core/paths.js";
import { buildStorage, type StorageConfig, type StorageKind } from "./storage/adapter.js";
import { manualStorage } from "./storage/manual.js";
import { mirrorStorage, type CloudStatus } from "./storage/mirror.js";
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

async function writeConfig(cfg: StorageConfig): Promise<void> {
  await ensureDir(rootDir());
  await writeFile(configFile(), JSON.stringify(cfg, null, 2));
}

/** True once a storage backend has been chosen on this device. */
export async function isInitialized(): Promise<boolean> {
  return (await readConfig()) !== null;
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
  const local = manualStorage();
  const cfg = await readConfig();
  const cloud = cfg ? await buildStorage(cfg) : undefined;
  return { wallet, storage: mirrorStorage(local, cloud, onCloudStatus) };
}

// True if a CLOUD backend is connected (local is always on regardless).
export async function isCloudConnected(): Promise<boolean> {
  return (await readConfig()) !== null;
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

// Turn the cloud mirror OFF: forget the cloud choice + OAuth token on THIS device.
// Local sessions stay (login() falls back to local-only). You can reconnect later
// with initialize() — this is the "add a cloud later / turn it off" toggle.
export async function disconnectCloud(): Promise<void> {
  await rm(configFile(), { force: true });
  await rm(tokenFile("google"), { force: true });
}

/** @deprecated use disconnectCloud — kept for callers still importing logout. */
export const logout = disconnectCloud;
