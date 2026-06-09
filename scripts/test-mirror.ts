// MirrorStorage: local always on, cloud optional. Verify dual-write, read fallback,
// list union, and that a failing cloud never breaks local (offline tolerance).

import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorStorage } from "../src/account/storage/mirror.js";
import { icloudStorage } from "../src/account/storage/icloud.js";
import { testWallet } from "../src/account/keypairWallet.js";
import { SessionStore } from "../src/account/store.js";
import type { StorageAdapter } from "../src/runtime/contract.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? "✅" : "❌"} ${n}`); if (!ok) pass = false; };

const meta = (id: string) => ({ sessionId: id, cli: "claude" as const, title: "t", ts: Date.now() });
const msg = (t: string) => ({ role: "user" as const, text: t, ts: Date.now() });

// a cloud adapter that always throws, to prove local survives offline cloud
const brokenCloud: StorageAdapter = {
  async put() { throw new Error("offline"); },
  async get() { throw new Error("offline"); },
  async list() { throw new Error("offline"); },
  async remove() { throw new Error("offline"); },
};

async function main() {
  const w = testWallet();
  const root = await mkdtemp(join(tmpdir(), "agentnet-mirror-"));
  const localDir = join(root, "local");
  const cloudDir = join(root, "cloud");

  // 1. local-only (no cloud) — works, writes only locally
  const localOnly = mirrorStorage(icloudStorage(localDir));
  const s1 = new SessionStore(w, localOnly);
  await s1.appendMessage(meta("a"), msg("local only"));
  check("local-only saves + reloads", (await s1.load("a"))?.messages.length === 1);

  // 2. local + cloud mirror — writes to BOTH
  const mirror = mirrorStorage(icloudStorage(localDir), icloudStorage(cloudDir));
  const s2 = new SessionStore(w, mirror);
  await s2.appendMessage(meta("b"), msg("mirrored"));
  const localFiles = await readdir(localDir);
  const cloudFiles = await readdir(cloudDir);
  check("mirror writes to local", localFiles.some((f) => f.includes("b")));
  check("mirror writes to cloud", cloudFiles.some((f) => f.includes("b")));
  check("mirror reloads", (await s2.load("b"))?.messages[0]?.text === "mirrored");

  // 3. read fallback — session only in cloud (another device) is found
  const cloudData = mirrorStorage(icloudStorage(join(root, "empty-local")), icloudStorage(cloudDir));
  const s3 = new SessionStore(w, cloudData);
  check("reads from cloud when local missing", (await s3.load("b"))?.messages[0]?.text === "mirrored");

  // 4. offline cloud — local still works, no throw
  const flaky = mirrorStorage(icloudStorage(localDir), brokenCloud);
  const s4 = new SessionStore(w, flaky);
  let threw = false;
  try { await s4.appendMessage(meta("c"), msg("cloud is down")); } catch { threw = true; }
  check("offline cloud does NOT break local write", !threw);
  check("local write succeeded despite cloud error", (await s4.load("c"))?.messages.length === 1);

  await rm(root, { recursive: true, force: true });
  console.log(pass ? "\n✅ PASS — mirror: local-always + optional cloud + offline-safe." : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error("test error:", e); process.exit(1); });
