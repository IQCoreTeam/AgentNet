// Storage backend registry. Every backend (local, gdrive, icloud, custom) is a
// StorageAdapter (put/get/list — see runtime/contract). This file is the one place
// that knows the list of kinds and how to build one from a saved config, so login.ts
// and the UI stay backend-agnostic — adding a backend = one entry here.

import type { StorageAdapter } from "../../runtime/contract.js";

export type StorageKind = "local" | "gdrive" | "icloud" | "custom";

// Persisted, non-secret config for the chosen backend (lives in the user's
// local profile, NOT our server). Secrets (OAuth tokens) live separately via oauth.ts.
export interface StorageConfig {
  kind: StorageKind;
  // icloud/custom-local: a folder path; custom-http: a base URL; gdrive: unused.
  location?: string;
  // custom http: optional bearer for the user's own endpoint.
  authHeader?: string;
}

// Lazy builders so importing the registry doesn't pull every backend's deps.
type Builder = (cfg: StorageConfig) => Promise<StorageAdapter>;

const builders: Record<StorageKind, Builder> = {
  local: async () => (await import("./manual.js")).manualStorage(),
  gdrive: async () => (await import("./gdrive.js")).gdriveStorage(),
  icloud: async (cfg) => (await import("./icloud.js")).icloudStorage(cfg.location),
  custom: async (cfg) => (await import("./custom.js")).customStorage(cfg),
};

export async function buildStorage(cfg: StorageConfig): Promise<StorageAdapter> {
  const make = builders[cfg.kind];
  if (!make) throw new Error(`unknown storage kind: ${cfg.kind}`);
  return make(cfg);
}

// What the UI shows in the "where to save?" picker.
export const STORAGE_OPTIONS: { kind: StorageKind; label: string; needs: string }[] = [
  { kind: "gdrive", label: "Google Drive", needs: "sign in with Google" },
  { kind: "icloud", label: "iCloud Drive", needs: "pick your iCloud folder" },
  { kind: "custom", label: "Custom (S3 / WebDAV / HTTP)", needs: "enter endpoint" },
  { kind: "local", label: "This device only", needs: "nothing" },
];
