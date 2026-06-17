// RPC resolution (issue #23) — one place that decides which Solana RPC the chain
// reads/writes go through, so a user never edits env vars. The Helius API KEY (not a
// URL) is stored like an OAuth token: secret, per-device, never synced — mirroring
// account/storage/oauth.ts. We template the URL from the key + the central NETWORK
// (seed.ts), so flipping devnet/mainnet in ONE place retargets everything and the key
// never appears in the non-secret config.
//
// Priority (resolveRpcUrl): stored Helius key -> env (DAS_RPC_URL / SOLANA_RPC_URL)
// -> built-in default. The default is the public network RPC, which works for tx sends
// but does NOT serve the DAS API the marketplace reads need — that's why we push Helius.

import { readFile, writeFile } from "node:fs/promises";
import { tokenFile, tokensDir, ensureDir } from "./paths.js";
import { getNetwork, type Network } from "./seed.js";

const PROVIDER = "helius";

// Public RPC per network: fine for tx sends, but NO DAS (getAssetsByGroup) — the
// marketplace returns empty on it. A Helius key (free tier) gives DAS.
const PUBLIC_RPC: Record<Network, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

interface StoredKey {
  api_key: string;
}

// Helius RPC URL from a bare key, on the central network. Helius serves both standard
// RPC and the DAS API on the same endpoint, so this one URL covers sends AND reads.
export function heliusUrl(apiKey: string, network: Network = getNetwork()): string {
  return `https://${network}.helius-rpc.com/?api-key=${apiKey}`;
}

// Pull the bare key out of whatever the user pasted. People often paste the whole
// Helius RPC URL (https://…helius-rpc.com/?api-key=KEY) instead of just the key — accept
// both: if it's a URL, take the api-key query param; otherwise it's already the key.
export function normalizeHeliusKey(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/[?&]api-key=([^&\s]+)/i);
    if (m) return m[1];
  }
  return s;
}

// Save the user's Helius key (secret, 0o600, never synced) — same shape/perm as the
// google OAuth token. Pass ""/null to clear it (fall back to env/default). Network is
// NOT stored — it always follows the central NETWORK, so a devnet->mainnet flip needs
// no per-key change. Input is normalized so pasting the full RPC URL also works.
export async function saveHeliusKey(apiKey: string): Promise<void> {
  await ensureDir(tokensDir());
  const data: StoredKey = { api_key: normalizeHeliusKey(apiKey) };
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
 * The RPC URL the whole app should use: stored Helius key (templated on the central
 * network) -> env override -> public default. Every chain read/write site calls this
 * instead of reading process.env directly, so the UI-chosen key takes effect app-wide.
 */
export async function resolveRpcUrl(): Promise<string> {
  const helius = await loadHeliusKey();
  if (helius) return heliusUrl(helius.api_key);
  return process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL || PUBLIC_RPC[getNetwork()];
}

/** Whether a DAS-capable RPC is configured (a Helius key, or an explicit env RPC the
 *  operator set on purpose). On the bare public default reads are empty. */
export async function hasDasRpc(): Promise<boolean> {
  if (await loadHeliusKey()) return true;
  return !!(process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL);
}

/** A masked view of the stored key for the UI: only the last 4 chars, rest dotted.
 *  null when no key is set. The full key never leaves the host as plain text. */
export async function maskedHeliusKey(): Promise<string | null> {
  const k = await loadHeliusKey();
  if (!k) return null;
  const key = k.api_key;
  const tail = key.slice(-4);
  return key.length <= 4 ? tail : "••••" + tail;
}

// ── GitHub Personal Access Token ──────────────────────────────────────────────
// Stored same way as Helius key: secret, per-device, 0o600, never synced.
// Used so the agent can `git push` (§0b round-trips) and for cross-device
// GitHub-based session sync (§2 continuity).

const GITHUB_PROVIDER = "github";

interface StoredGithubToken {
  token: string;
}

export async function saveGithubToken(token: string): Promise<void> {
  await ensureDir(tokensDir());
  const data: StoredGithubToken = { token: token.trim() };
  await writeFile(tokenFile(GITHUB_PROVIDER), JSON.stringify(data), { mode: 0o600 });
}

export async function loadGithubToken(): Promise<StoredGithubToken | null> {
  try {
    const t = JSON.parse(await readFile(tokenFile(GITHUB_PROVIDER), "utf8")) as StoredGithubToken;
    return t.token ? t : null;
  } catch {
    return null;
  }
}

export async function maskedGithubToken(): Promise<string | null> {
  const t = await loadGithubToken();
  if (!t) return null;
  const tail = t.token.slice(-4);
  return "••••" + tail;
}
