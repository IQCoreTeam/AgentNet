// Verified work: prove a GitHub repo was built with a skill, then register the
// repo<->skill link with the NFT indexer. Runs SERVER-SIDE (the node host),
// where the user's GitHub token lives — never in a browser.
//
// Ownership is proved with a `.agentnet` marker committed to the repo. The
// marker holds ONLY the wallet's PUBLIC address (it lands in a public repo, so a
// secret/private key must NEVER go in it — see buildMarker). The indexer
// re-reads the marker publicly to verify before storing, so there is no shared
// secret and no signature: the marker IS the proof.

import { getIndexerUrl } from "./seed.js";

const MARKER_PATH = ".agentnet";
const GH_API = "https://api.github.com";
const UA = "AgentNet";

/** The marker file content. PUBLIC wallet address ONLY. */
export function buildMarker(walletAddress: string): string {
  return [
    "# AgentNet verified-work marker — PUBLIC wallet address only. NEVER a secret/private key.",
    `wallet: ${walletAddress}`,
    "",
  ].join("\n");
}

/** "owner/name" or a github.com URL -> { owner, name }, or null. */
export function parseRepo(input: string): { owner: string; name: string } | null {
  let s = (input || "").trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, "").replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  s = s.replace(/\.git$/i, "").replace(/^\/+/, "").replace(/\/+$/, "");
  const [owner, name] = s.split("/").filter(Boolean);
  if (!owner || !name) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  return { owner, name };
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Commit `.agentnet` (the public wallet marker) to the repo's default branch via
 *  the GitHub Contents API. Idempotent — updates the file if it already exists.
 *  Throws a human-readable error (no write access, repo missing, ...). */
export async function pushMarker(token: string, owner: string, name: string, walletAddress: string): Promise<void> {
  const url = `${GH_API}/repos/${owner}/${name}/contents/${MARKER_PATH}`;
  let sha: string | undefined;
  const head = await fetch(url, { headers: ghHeaders(token) });
  if (head.ok) {
    sha = ((await head.json()) as { sha?: string }).sha;
  } else if (head.status !== 404) {
    throw new Error(`Can't read ${owner}/${name} (HTTP ${head.status}). Check the GitHub token has access.`);
  }
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Add AgentNet verified-work marker (.agentnet)",
      content: Buffer.from(buildMarker(walletAddress), "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      throw new Error(`This GitHub token can't write to ${owner}/${name} (need 'repo' / Contents:write).`);
    }
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub commit failed (HTTP ${res.status}). ${body.slice(0, 140)}`);
  }
}

/** POST the repo<->skill link to the indexer. The indexer re-reads the marker
 *  publicly to verify before storing. Throws on a non-ok response. */
export async function registerWorkLink(
  repo: string,
  skillMints: string[],
  walletAddress: string,
): Promise<{ count: number }> {
  const res = await fetch(`${getIndexerUrl()}/work-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, skillMints, wallet: walletAddress }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; count?: number };
  if (!res.ok || !j.ok) throw new Error(j.error || `Indexer rejected the registration (HTTP ${res.status}).`);
  return { count: j.count ?? skillMints.length };
}

/** Full flow: push the marker, then register with the indexer. Returns the
 *  number of (skill, repo) links stored. */
export async function registerVerifiedWork(opts: {
  token: string;
  repo: string;
  skillMints: string[];
  walletAddress: string;
}): Promise<{ count: number; repo: string }> {
  const parsed = parseRepo(opts.repo);
  if (!parsed) throw new Error("Enter a repo as owner/name or a github.com URL.");
  if (opts.skillMints.length === 0) throw new Error("Pick at least one skill this repo used.");
  await pushMarker(opts.token, parsed.owner, parsed.name, opts.walletAddress);
  const repo = `${parsed.owner}/${parsed.name}`;
  const { count } = await registerWorkLink(repo, opts.skillMints, opts.walletAddress);
  return { count, repo };
}
