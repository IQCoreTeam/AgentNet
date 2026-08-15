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
import { getNetwork, getPublicRpcUrl, type Network } from "./seed.js";

const PROVIDER = "helius";

// Where users get a free key. Single source for every surface's "get your key" link
// (CLI onboarding + welcome panel, VSCode onboarding, mobile settings) so the URL never drifts.
export const HELIUS_QUICKSTART_URL = "https://www.helius.dev/docs/quickstart";

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

// One network probe per distinct Helius URL. A WORKING key rarely dies mid-session, so a
// success is cached for a while; a REJECTED key (bad IP allowlist, revoked, transient edge
// 403) is usually fixable, so it is re-checked soon instead of being trusted-dead for the
// whole process — the old cache-forever meant a key you JUST fixed stayed "dead" until the
// process restarted (re-entering the same key didn't help: same key = same URL = same cache).
const PROBE_OK_TTL_MS = 5 * 60_000;
const PROBE_FAIL_TTL_MS = 20_000;
const heliusProbe = new Map<string, { ok: boolean; at: number }>();

// A stored key can answer getHealth (NOT auth-gated) yet return -32401 Unauthorized (or a
// bare 403 at the edge) on every real read — which silently bricks ALL chain reads (owned
// skills, skill text, comments) with no visible cause. Probe one real, cheap method
// (getVersion) to tell a live key from a dead one. Any error/timeout = treat as dead.
async function heliusKeyWorks(url: string): Promise<boolean> {
  const hit = heliusProbe.get(url);
  if (hit && Date.now() - hit.at < (hit.ok ? PROBE_OK_TTL_MS : PROBE_FAIL_TTL_MS)) return hit.ok;
  let ok = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "getVersion" }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const json = (await res.json()) as { error?: unknown; result?: unknown };
    ok = !json.error && !!json.result;
  } catch {
    ok = false;
  }
  heliusProbe.set(url, { ok, at: Date.now() });
  // A rejected key otherwise fails SILENTLY (resolveRpcUrl just falls back), which is exactly
  // what makes an empty skill market impossible to diagnose. Log the HOST only, never the
  // key/url. Bounded by the fail-TTL above, so this can't spam per chain read.
  if (!ok) {
    console.warn(`[rpc] Helius key rejected by ${new URL(url).host} (revoked / IP allowlist / transient?); using a public RPC — DAS reads (skill market) will be empty until the key works.`);
  }
  return ok;
}

/**
 * The RPC URL the whole app should use: stored Helius key (templated on the central
 * network) -> env override -> public default. Every chain read/write site calls this
 * instead of reading process.env directly, so the UI-chosen key takes effect app-wide.
 *
 * A stored Helius key is VALIDATED once (heliusKeyWorks): an expired/revoked key would
 * otherwise be trusted blindly and brick every read with a bare "Unauthorized". When it
 * fails we fall back to the env/public RPC — standard reads (owned skills via
 * getTokenAccountsByOwner, skill text via the gateway, comments) all work there; only
 * DAS-tier enumeration degrades, and the NFT indexer is the primary catalog path anyway.
 */
export async function resolveRpcUrl(): Promise<string> {
  const fallback = process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL || getPublicRpcUrl();
  const helius = await loadHeliusKey();
  if (!helius) return fallback;
  const url = heliusUrl(helius.api_key);
  return (await heliusKeyWorks(url)) ? url : fallback;
}

/** Whether a DAS-capable RPC is actually ANSWERING — not merely configured. Derived from the
 *  ONE resolver above instead of re-deciding here: everything except the bare public default
 *  (a probed-live Helius key, or an explicit env RPC) is the DAS path, so this is true exactly
 *  when resolveRpcUrl did NOT land on the public fallback, and the two can never disagree.
 *  Same cost: the probe is cached per URL, so this adds no extra round-trip. */
export async function hasDasRpc(): Promise<boolean> {
  return (await resolveRpcUrl()) !== getPublicRpcUrl();
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
// Two consumers only: the agent's git credential helper, so it can clone/push
// private repos (see spawn.ts gitCredentialEnv), and verified-work registration
// for the profile (see verifiedWork.ts). It does NOT sync chat sessions — those
// are the encrypted-page storage backends (local | gdrive | icloud | custom);
// this token never touches them.

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
