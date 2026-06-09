// Storage-module test (no CLI). Verifies my account/storage adapters + login flow
// against the real SessionStore, using fake session data.
//   1. icloud adapter (local-folder) — save → reload → append grows → no dup file
//   2. custom adapter — against a tiny in-process HTTP server (PUT/GET/list)
//   3. login flow — initialize(custom) → config.json → login() rebuilds storage
// Run: pnpm tsx scripts/test-storage.ts

import { createServer } from "node:http";
import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/account/store.js";
import { icloudStorage } from "../src/account/storage/icloud.js";
import { customStorage } from "../src/account/storage/custom.js";
import { initialize, login } from "../src/account/login.js";
import { testWallet } from "../src/account/keypairWallet.js";

const wallet = testWallet(9);

const meta = (id: string) => ({ sessionId: id, cli: "claude" as const, title: "test", ts: Date.now() });
const msg = (text: string) => ({ role: "user" as const, text, ts: Date.now() });

let pass = true;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}`);
  if (!ok) pass = false;
};

// 1. iCloud adapter (local folder) -------------------------------------------
async function testIcloud() {
  console.log("→ icloud adapter (local folder)");
  const dir = join(tmpdir(), `agentnet-icloud-${Date.now()}`);
  const storage = icloudStorage(dir);
  const store = new SessionStore(wallet, storage);
  const id = "sess-icloud-1";

  await store.appendMessage(meta(id), msg("first"));
  const a = await store.load(id);
  check("save + reload", a?.messages.length === 1);

  await store.appendMessage(meta(id), msg("second"));
  const b = await store.load(id);
  check("append grows (1 → 2)", (b?.messages.length ?? 0) === 2);

  const files = await readdir(dir);
  check("no duplicate file (one .bin)", files.filter((f) => f.endsWith(".bin")).length === 1);

  const ids = await storage.list();
  check("list() finds the session", ids.includes(id));

  await rm(dir, { recursive: true, force: true });
}

// 2. custom adapter (in-process HTTP) ----------------------------------------
async function testCustom() {
  console.log("→ custom adapter (HTTP PUT/GET/list)");
  const objs = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "", "http://x");
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      objs.set(url.pathname, Buffer.concat(chunks));
      res.statusCode = 200;
      res.end();
    } else if (req.method === "GET" && url.search === "?list") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([...objs.keys()]));
    } else if (req.method === "GET") {
      const b = objs.get(url.pathname);
      if (!b) { res.statusCode = 404; res.end(); return; }
      res.end(b);
    } else { res.statusCode = 405; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const storage = customStorage({ kind: "custom", location: base });
  const store = new SessionStore(wallet, storage);
  const id = "sess-custom-1";

  await store.appendMessage(meta(id), msg("hello over http"));
  const a = await store.load(id);
  check("save + reload over HTTP", a?.messages.length === 1);

  const ids = await storage.list();
  check("list() over HTTP finds it", ids.includes(id));

  server.close();
}

// 3. login flow (initialize → config → login) --------------------------------
async function testLogin() {
  console.log("→ login flow (initialize custom → config.json → login)");
  const home = join(tmpdir(), `agentnet-home-${Date.now()}`);
  process.env.AGENTNET_HOME = home; // paths.ts root override
  const dir = join(tmpdir(), `agentnet-login-store-${Date.now()}`);

  // initialize with a local-folder "custom" (icloud kind, reuse folder) to avoid network
  await initialize({ kind: "icloud", location: dir });
  const session = await login(wallet);
  check("login() returns a storage", !!session.storage);

  const store = new SessionStore(session.wallet, session.storage);
  await store.appendMessage(meta("sess-login-1"), msg("via login flow"));
  const reloaded = await store.load("sess-login-1");
  check("save + reload through login()'s storage", reloaded?.messages.length === 1);

  await rm(home, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
  delete process.env.AGENTNET_HOME;
}

async function main() {
  await testIcloud();
  await testCustom();
  await testLogin();
  console.log(pass ? "\n✅ PASS — storage adapters + login flow work." : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error("test error:", e);
  process.exit(1);
});
