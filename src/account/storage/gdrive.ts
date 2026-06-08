// Google Drive StorageAdapter — stores each session blob as one file in the
// app-private appDataFolder (the user's other Drive files are never touched).
// Docs: https://developers.google.com/workspace/drive/api/guides/appdata
//
// Filename = "<sessionId>.bin". To avoid duplicates we look up the file id by
// name first: exists → PATCH (overwrite), else → POST (create). No append API on
// Drive, so put() uploads the whole blob — fine because the blob is a small log.

import { getAccessToken } from "./oauth.js";
import type { StorageAdapter } from "../../runtime/contract.js";

const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILES = "https://www.googleapis.com/drive/v3/files";

async function auth(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

function name(sessionId: string): string {
  return `${sessionId}.bin`;
}

// Find the Drive file id for a sessionId in appDataFolder, or null.
async function findId(sessionId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name(sessionId)}'`);
  const url = `${FILES}?spaces=appDataFolder&q=${q}&fields=files(id)`;
  const res = await fetch(url, { headers: await auth() });
  if (!res.ok) throw new Error(`drive list failed: ${res.status}`);
  const data = (await res.json()) as { files: { id: string }[] };
  return data.files[0]?.id ?? null;
}

export function gdriveStorage(): StorageAdapter {
  return {
    async put(sessionId, blob) {
      const id = await findId(sessionId);
      if (id) {
        // overwrite existing file content (media-only PATCH)
        const res = await fetch(`${UPLOAD}/${id}?uploadType=media`, {
          method: "PATCH",
          headers: { ...(await auth()), "Content-Type": "application/octet-stream" },
          body: Buffer.from(blob),
        });
        if (!res.ok) throw new Error(`drive update failed: ${res.status}`);
      } else {
        // create new file in appDataFolder (multipart: metadata + content)
        const boundary = "agentnet" + Math.random().toString(36).slice(2);
        const meta = JSON.stringify({ name: name(sessionId), parents: ["appDataFolder"] });
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
      const id = await findId(sessionId);
      if (!id) return null;
      const res = await fetch(`${FILES}/${id}?alt=media`, { headers: await auth() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`drive get failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async list() {
      const url = `${FILES}?spaces=appDataFolder&fields=files(name)&pageSize=1000`;
      const res = await fetch(url, { headers: await auth() });
      if (!res.ok) throw new Error(`drive list failed: ${res.status}`);
      const data = (await res.json()) as { files: { name: string }[] };
      return data.files
        .filter((f) => f.name.endsWith(".bin"))
        .map((f) => f.name.slice(0, -4));
    },

    async remove(sessionId) {
      const id = await findId(sessionId);
      if (!id) return; // already gone
      const res = await fetch(`${FILES}/${id}`, { method: "DELETE", headers: await auth() });
      if (!res.ok && res.status !== 404) throw new Error(`drive remove failed: ${res.status}`);
    },
  };
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
