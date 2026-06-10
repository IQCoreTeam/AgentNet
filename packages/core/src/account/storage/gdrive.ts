// Google Drive StorageAdapter — stores each session blob as one file inside a
// VISIBLE, PER-WALLET folder "AgentNet/{walletAddress}/sessions" in the user's
// Drive, so different agents (= wallets) keep separate session sets and the
// signed-in user can open their own files (the old appDataFolder was hidden).
// With the drive.file scope we still only touch files THIS app created.
//
// Filename = "<sessionId>.txt". Look up by name within the folder first: exists →
// PATCH (overwrite), else → POST (create). No append API, so put() uploads the
// whole blob — fine because the blob is a small log.

import { getAccessToken } from "./oauth.js";
import type { StorageAdapter } from "../../runtime/contract.js";

const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function auth(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

// .txt so the file opens as text in Drive. The CONTENT is still encrypted JSONL
// (one {senderPub,iv,ciphertext} line per message) — readable as text but not
// decryptable without the wallet key. Privacy kept; the file is just openable.
const EXT = ".txt";
function name(sessionId: string): string {
  return `${sessionId}${EXT}`;
}

// Find a folder by name under `parent` (or root), creating it if absent. Returns
// its id. Cached per-process so we don't re-resolve the folder every call.
const folderCache = new Map<string, string>();
async function ensureFolder(folderName: string, parent?: string): Promise<string> {
  const cacheKey = `${parent ?? "root"}/${folderName}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const parentClause = parent ? ` and '${parent}' in parents` : "";
  const q = encodeURIComponent(
    `name='${folderName}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`,
  );
  const res = await fetch(`${FILES}?q=${q}&fields=files(id)`, { headers: await auth() });
  if (!res.ok) throw new Error(`drive folder lookup failed: ${res.status}`);
  const found = ((await res.json()) as { files: { id: string }[] }).files[0]?.id;
  if (found) {
    folderCache.set(cacheKey, found);
    return found;
  }

  const meta: Record<string, unknown> = { name: folderName, mimeType: FOLDER_MIME };
  if (parent) meta.parents = [parent];
  const create = await fetch(`${FILES}?fields=id`, {
    method: "POST",
    headers: { ...(await auth()), "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  if (!create.ok) throw new Error(`drive folder create failed: ${create.status}`);
  const id = ((await create.json()) as { id: string }).id;
  folderCache.set(cacheKey, id);
  return id;
}

// The "AgentNet/{wallet}/sessions" folder id (created on first use). Per-wallet so
// each agent's sessions live apart. Pass "" only for the legacy flat layout lookup.
async function sessionsFolder(walletAddress: string): Promise<string> {
  const agentnet = await ensureFolder("AgentNet");
  const wallet = await ensureFolder(walletAddress, agentnet);
  return ensureFolder("sessions", wallet);
}

// The user-openable URL of the visible "AgentNet/{wallet}" folder (only they can
// see it). Returned to the UI so "open cloud" jumps straight to the agent's folder.
export async function agentnetFolderLink(walletAddress: string): Promise<string | null> {
  try {
    const agentnet = await ensureFolder("AgentNet");
    const wallet = await ensureFolder(walletAddress, agentnet);
    const res = await fetch(`${FILES}/${wallet}?fields=webViewLink`, { headers: await auth() });
    if (!res.ok) return null;
    return ((await res.json()) as { webViewLink?: string }).webViewLink ?? null;
  } catch {
    return null;
  }
}

// Find the Drive file id for a sessionId inside the wallet's sessions folder.
async function findId(walletAddress: string, sessionId: string): Promise<string | null> {
  const folder = await sessionsFolder(walletAddress);
  const q = encodeURIComponent(`name='${name(sessionId)}' and '${folder}' in parents and trashed=false`);
  const res = await fetch(`${FILES}?q=${q}&fields=files(id)`, { headers: await auth() });
  if (!res.ok) throw new Error(`drive list failed: ${res.status}`);
  const data = (await res.json()) as { files: { id: string }[] };
  return data.files[0]?.id ?? null;
}

export function gdriveStorage(walletAddress: string): StorageAdapter {
  return {
    async put(sessionId, blob) {
      const id = await findId(walletAddress, sessionId);
      if (id) {
        // overwrite existing file content (media-only PATCH)
        const res = await fetch(`${UPLOAD}/${id}?uploadType=media`, {
          method: "PATCH",
          headers: { ...(await auth()), "Content-Type": "application/octet-stream" },
          body: Buffer.from(blob),
        });
        if (!res.ok) throw new Error(`drive update failed: ${res.status}`);
      } else {
        // create the file inside the visible AgentNet/{wallet}/sessions folder
        const folder = await sessionsFolder(walletAddress);
        const boundary = "agentnet" + Math.random().toString(36).slice(2);
        const meta = JSON.stringify({ name: name(sessionId), parents: [folder] });
        const body = buildMultipart(boundary, meta, blob);
        const res = await fetch(`${UPLOAD}?uploadType=multipart`, {
          method: "POST",
          headers: {
            ...(await auth()),
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: Buffer.from(body),
        });
        if (!res.ok) throw new Error(`drive create failed: ${res.status}`);
      }
    },

    async get(sessionId) {
      const id = await findId(walletAddress, sessionId);
      if (!id) return null;
      const res = await fetch(`${FILES}/${id}?alt=media`, { headers: await auth() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`drive get failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async list() {
      const folder = await sessionsFolder(walletAddress);
      const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
      const url = `${FILES}?q=${q}&fields=files(name)&pageSize=1000`;
      const res = await fetch(url, { headers: await auth() });
      if (!res.ok) throw new Error(`drive list failed: ${res.status}`);
      const data = (await res.json()) as { files: { name: string }[] };
      return data.files
        .filter((f) => f.name.endsWith(EXT))
        .map((f) => f.name.slice(0, -EXT.length));
    },

    async remove(sessionId) {
      const id = await findId(walletAddress, sessionId);
      if (!id) return; // already gone
      const res = await fetch(`${FILES}/${id}`, { method: "DELETE", headers: await auth() });
      if (!res.ok && res.status !== 404) throw new Error(`drive remove failed: ${res.status}`);
    },
  };
}

// One-time: move pre-wallet-folder sessions (the old flat AgentNet/sessions/) INTO
// the wallet's folder, by reparenting each file (no re-upload). Best-effort; safe to
// call every connect. No-op when there's no legacy folder or it's already empty.
export async function migrateLegacyDriveSessions(walletAddress: string): Promise<void> {
  try {
    const agentnet = await ensureFolder("AgentNet");
    // the OLD layout was AgentNet/sessions (directly under AgentNet, no wallet level)
    const q = encodeURIComponent(
      `name='sessions' and mimeType='${FOLDER_MIME}' and '${agentnet}' in parents and trashed=false`,
    );
    const res = await fetch(`${FILES}?q=${q}&fields=files(id)`, { headers: await auth() });
    if (!res.ok) return;
    const legacy = ((await res.json()) as { files: { id: string }[] }).files[0]?.id;
    if (!legacy) return; // nothing to migrate

    const dest = await sessionsFolder(walletAddress);
    if (dest === legacy) return; // somehow the same — skip

    const lq = encodeURIComponent(`'${legacy}' in parents and trashed=false`);
    const lres = await fetch(`${FILES}?q=${lq}&fields=files(id,name)&pageSize=1000`, { headers: await auth() });
    if (!lres.ok) return;
    const files = ((await lres.json()) as { files: { id: string; name: string }[] }).files;
    for (const f of files) {
      if (!f.name.endsWith(EXT)) continue;
      await fetch(`${FILES}/${f.id}?addParents=${dest}&removeParents=${legacy}&fields=id`, {
        method: "PATCH",
        headers: await auth(),
      }).catch(() => {});
    }
  } catch {
    /* best-effort */
  }
}

// metadata part + binary part as a single multipart/related body
function buildMultipart(boundary: string, metaJson: string, blob: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(head.length + blob.length + tail.length);
  out.set(head, 0);
  out.set(blob, head.length);
  out.set(tail, head.length + blob.length);
  return out;
}
