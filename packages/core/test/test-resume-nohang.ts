// Resume must NEVER hang on a stalled cloud. Proves loadLatestLocal reads the local tier
// only — it resolves instantly even when the cloud adapter never settles (the exact bug:
// an un-timed Drive read left "Resuming…" spinning forever). Also proves loadLatest (the
// cloud-capable path) genuinely WOULD hang on the same cloud, so the fix is load-only-local.

import { mkdtemp, rm } from "node:fs/promises";
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

// a cloud that NEVER responds — get/list return a promise that never settles, exactly like
// a stalled Drive fetch with no timeout (accepts the connection, never answers).
const hangingCloud: StorageAdapter = {
  async put() { /* not exercised: we seed local via a cloud-less store */ },
  get() { return new Promise<Uint8Array | null>(() => {}); },   // never resolves
  list() { return new Promise<string[]>(() => {}); },           // never resolves
  async remove() {},
};

// race a promise against a deadline so a hang shows up as a test failure, not a frozen run.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<{ hung: false; value: T } | { hung: true }> {
  return Promise.race([
    p.then((value) => ({ hung: false as const, value })),
    new Promise<{ hung: true }>((res) => setTimeout(() => res({ hung: true }), ms)),
  ]);
}

async function main() {
  const w = testWallet();
  const root = await mkdtemp(join(tmpdir(), "agentnet-nohang-"));
  const localDir = join(root, "local");

  // Seed session "x" into LOCAL via a cloud-less store (so the write doesn't touch cloud).
  const seed = new SessionStore(w, mirrorStorage(icloudStorage(localDir)));
  await seed.appendMessage(meta("x"), msg("hello from local"));

  // Now read through a mirror whose cloud HANGS forever, pointed at the same local dir.
  const mirror = mirrorStorage(icloudStorage(localDir), hangingCloud);
  const store = new SessionStore(w, mirror);

  // 1) local-present session: loadLatestLocal resolves instantly with the real messages.
  const r1 = await withDeadline(store.loadLatestLocal("x"), 1500);
  check("loadLatestLocal returns (no hang) for a local session", !r1.hung);
  check("loadLatestLocal returns the local messages", !r1.hung && r1.value.messages[0]?.text === "hello from local");

  // 2) session NOT on this device: loadLatestLocal still resolves instantly (empty page),
  //    instead of blocking on the hanging cloud. This is the "nothing local → end loading"
  //    behaviour the resume paint relies on.
  const r2 = await withDeadline(store.loadLatestLocal("missing"), 1500);
  check("loadLatestLocal returns (no hang) for a cloud-only/missing session", !r2.hung);
  check("loadLatestLocal yields an empty page when local has nothing", !r2.hung && r2.value.messages.length === 0);

  // 3) control: the cloud-capable loadLatest DOES hang on the same store + missing session
  //    (local miss → cloud.list/get never settle). This is what the paint path used to call.
  const r3 = await withDeadline(store.loadLatest("missing"), 1200);
  check("control: loadLatest (cloud path) hangs on a stalled cloud", r3.hung === true);

  await rm(root, { recursive: true, force: true });
  console.log(pass ? "\n✅ PASS — resume reads local only; a stalled cloud can't wedge it." : "\n❌ FAIL");
  // The control case leaves an unsettled cloud promise dangling; exit explicitly.
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("test error:", e); process.exit(1); });
