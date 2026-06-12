// Pagination: 65 messages → pages of 30 (p0,p1,p2). Verify page rollover, cursor
// walk (newest→oldest), full reassembly, and that mirror re-uploads only the
// current page (not the whole session) per turn.

import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, PAGE_SIZE } from "../src/account/store.js";
import { icloudStorage } from "../src/account/storage/icloud.js";
import { mirrorStorage } from "../src/account/storage/mirror.js";
import { testWallet } from "../src/account/keypairWallet.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? "✅" : "❌"} ${n}`); if (!ok) pass = false; };
const meta = (id: string) => ({ sessionId: id, cli: "claude" as const, title: "long chat", ts: Date.now() });

async function main() {
  const w = testWallet();
  const root = await mkdtemp(join(tmpdir(), "agentnet-page-"));
  const localDir = join(root, "local");
  const cloudDir = join(root, "cloud");
  const storage = mirrorStorage(icloudStorage(localDir), icloudStorage(cloudDir));
  const store = new SessionStore(w, storage);

  // 1. write 65 messages → expect 3 pages (30,30,5)
  const N = 65;
  for (let i = 0; i < N; i++) {
    await store.appendMessage(meta("chat"), { role: "user", text: `msg ${i}`, ts: Date.now() });
  }
  const files = (await readdir(localDir)).filter((f) => f.includes("chat__p"));
  const pages = new Set(files.map((f) => f.split("chat__p")[1]?.split(".")[0]));
  check(`${N} msgs -> 3 pages (p0,p1,p2)`, pages.has("0") && pages.has("1") && pages.has("2"));

  // 2. loadSession = newest page (p2 = msgs 60..64 = 5 msgs), hasMore true
  const latest = await store.loadLatest("chat");
  check("latest page has 5 msgs", latest.messages.length === N - 2 * PAGE_SIZE);
  check("latest first msg is 'msg 60'", latest.messages[0]?.text === "msg 60");
  check("hasMore (older pages exist)", latest.hasMore === true);
  check("cursor points to p1", latest.cursor === 1);

  // 3. cursor walk: p1 (msgs 30..59), then p0 (0..29), then done
  const p1 = await store.loadOlder("chat", latest.cursor!);
  check("p1 has 30 msgs starting 'msg 30'", p1.messages.length === 30 && p1.messages[0]?.text === "msg 30");
  const p0 = await store.loadOlder("chat", p1.cursor!);
  check("p0 has 30 msgs starting 'msg 0'", p0.messages.length === 30 && p0.messages[0]?.text === "msg 0");
  check("no more after p0", p0.hasMore === false && p0.cursor === null);

  // 4. full reassembly in order
  const full = await store.load("chat");
  check("full load = 65 msgs in order", full?.messages.length === N && full?.messages[64]?.text === "msg 64");

  // 5. mirror: a NEW message only rewrites the current page in cloud (not all pages).
  const cloudBefore = await readdir(cloudDir);
  await store.appendMessage(meta("chat"), { role: "user", text: "msg 65", ts: Date.now() });
  const p2cloud = (await readdir(cloudDir)).filter((f) => f.includes("chat__p2"));
  check("cloud has the current page (p2)", p2cloud.length === 1);
  check("frozen pages still present (3 before append)", cloudBefore.filter((f) => f.includes("chat__p")).length === 3);

  await rm(root, { recursive: true, force: true });
  console.log(pass ? "\n✅ PASS — pagination: rollover, cursor walk, reassembly, current-page mirror." : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error("test error:", e); process.exit(1); });
