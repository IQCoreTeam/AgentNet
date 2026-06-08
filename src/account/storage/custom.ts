// Custom StorageAdapter — the user's own HTTP endpoint (S3-compatible, WebDAV,
// or any server that speaks PUT/GET on a path). Keeps AgentNet storage-agnostic:
// "we provide no storage" — the user owns the bucket/box.
//
// Convention (simplest that works for S3 presign-less buckets and plain servers):
//   PUT    {base}/{sessionId}.bin     write/overwrite
//   GET    {base}/{sessionId}.bin     read   (404 → null)
//   GET    {base}/?list               list   → JSON string[] of object keys
// An optional bearer/authHeader is sent on every request. No append (whole-blob
// upload); fine since the blob is a small append-only log.

import type { StorageAdapter } from "../../runtime/contract.js";
import type { StorageConfig } from "./adapter.js";

export function customStorage(cfg: StorageConfig): StorageAdapter {
  const base = (cfg.location || "").replace(/\/$/, "");
  if (!base) throw new Error("custom storage needs a base URL (StorageConfig.location)");
  const headers: Record<string, string> = cfg.authHeader
    ? { Authorization: cfg.authHeader }
    : {};
  const objUrl = (sessionId: string) => `${base}/${sessionId}.bin`;

  return {
    async put(sessionId, blob) {
      const res = await fetch(objUrl(sessionId), {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: Buffer.from(blob),
      });
      if (!res.ok) throw new Error(`custom put failed: ${res.status}`);
    },
    async get(sessionId) {
      const res = await fetch(objUrl(sessionId), { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`custom get failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async list() {
      const res = await fetch(`${base}/?list`, { headers });
      if (!res.ok) throw new Error(`custom list failed: ${res.status}`);
      const keys = (await res.json()) as string[];
      return keys
        .filter((k) => k.endsWith(".bin"))
        .map((k) => k.replace(/^.*\//, "").slice(0, -4));
    },
    async remove(sessionId) {
      const res = await fetch(objUrl(sessionId), { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) throw new Error(`custom remove failed: ${res.status}`);
    },
  };
}
