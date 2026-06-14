// RPC resolution (issue #23) — one place that decides which Solana RPC the chain
// reads/writes go through, so a user never edits env vars. The Helius API KEY (not a
// URL) is stored like an OAuth token: secret, per-device, never synced — mirroring
// account/storage/oauth.ts. We template the URL from the key, so we control the
// network (devnet/mainnet) and the key never appears in the non-secret config.
//
// Priority (resolveRpcUrl): stored Helius key -> env (DAS_RPC_URL / SOLANA_RPC_URL)
// -> built-in default. The default is public devnet, which works for writes but does
// NOT serve the DAS API the marketplace reads need — that's why we push Helius.

import { readFile, writeFile } from "node:fs/promises";
import { tokenFile, tokensDir, ensureDir } from "./paths.js";

const PROVIDER = "helius";
// public devnet: fine for tx sends, but NO DAS (getAssetsByGroup) — marketplace reads
// return empty on it. Helius (free devnet tier) gives DAS; that's the recommended path.
const DEFAULT_RPC = "https://api.devnet.solana.com";

interface StoredKey {
  api_key: string;
  network?: "devnet" | "mainnet"; // which Helius endpoint to template (default devnet)
}

// Helius RPC URL from a bare key. Helius serves both standard RPC and the DAS API on
// the same endpoint, so this one URL covers sends AND getAssetsByGroup.
export function heliusUrl(apiKey: string, network: "devnet" | "mainnet" = "devnet"): string {
  return `https://${network}.helius-rpc.com/?api-key=${apiKey}`;
}

// Save the user's Helius key (secret, 0o600, never synced) — same shape/perm as the
// google OAuth token. Pass null/"" to clear it (fall back to env/default).
export async function saveHeliusKey(apiKey: string, network: "devnet" | "mainnet" = "devnet"): Promise<void> {
  await ensureDir(tokensDir());
  const data: StoredKey = { api_key: apiKey, network };
  await writeFile(tokenFile(PROVIDER), JSON.stringify(data), { mode: 0o600 });
}

export async function loadHeliusKey(): Promise<StoredKey | null> {
  try {
    const k = JSON.parse(await readFile(tokenFile(PROVIDER), "utf8")) as StoredKey;
    return k.api_key ? k : null;
  } catch {
    return null;
  }
}

/**
 * The RPC URL the whole app should use, resolved once: stored Helius key (templated)
 * -> env override -> public-devnet default. Every chain read/write site calls this
 * instead of reading process.env directly, so the UI-chosen key takes effect app-wide.
 */
export async function resolveRpcUrl(): Promise<string> {
  const helius = await loadHeliusKey();
  if (helius) return heliusUrl(helius.api_key, helius.network ?? "devnet");
  return process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL || DEFAULT_RPC;
}

/** Whether a DAS-capable RPC is configured (a Helius key). The marketplace reads need
 *  DAS; on the bare default they'll be empty, so the UI can warn + recommend Helius. */
export async function hasDasRpc(): Promise<boolean> {
  if (await loadHeliusKey()) return true;
  // an explicit env RPC is assumed DAS-capable (the operator set it on purpose)
  return !!(process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL);
}
