// Test localWallet: generate / load / invalid-reject / overwrite, + a session
// encrypt→decrypt round-trip through a generated wallet. No real ~/.config touched.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectKeypair,
  loadOrCreateWallet,
  solanaDefaultKeypairPath,
} from "../src/account/localWallet.js";
import { manualStorage } from "../src/account/storage/manual.js";
import { SessionStore } from "../src/account/store.js";

let pass = true;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}`);
  if (!ok) pass = false;
};

async function main() {
  console.log("default path:", solanaDefaultKeypairPath());
  const dir = await mkdtemp(join(tmpdir(), "agentnet-wallet-"));
  const path = join(dir, "id.json");

  // 1. missing → generate
  check("missing before create", (await inspectKeypair(path)) === "missing");
  const gen = await loadOrCreateWallet(path);
  check("created a new wallet", gen.created === true);
  check("has a base58 address", gen.address.length > 30);
  check("file is ok after create", (await inspectKeypair(path)) === "ok");

  // 2. ok → load same address, NOT created
  const reload = await loadOrCreateWallet(path);
  check("reload loads (not created)", reload.created === false);
  check("same address on reload", reload.address === gen.address);

  // 3. invalid → throws, does NOT overwrite
  const badPath = join(dir, "bad.json");
  await writeFile(badPath, "not a keypair");
  check("invalid detected", (await inspectKeypair(badPath)) === "invalid");
  let threw = false;
  try {
    await loadOrCreateWallet(badPath);
  } catch {
    threw = true;
  }
  check("invalid path throws (no overwrite)", threw);
  check("invalid file untouched", (await inspectKeypair(badPath)) === "invalid");

  // 4. invalid + overwrite → generates
  const fixed = await loadOrCreateWallet(badPath, { overwrite: true });
  check("overwrite creates a wallet", fixed.created === true);
  check("path now ok", (await inspectKeypair(badPath)) === "ok");

  // 5. session round-trip with the generated wallet
  process.env.AGENTNET_HOME = join(dir, "home");
  const store = new SessionStore(gen.wallet, manualStorage());
  await store.appendMessage(
    { sessionId: "s1", cli: "claude", title: "t", ts: Date.now() },
    { role: "user", text: "hello from real keypair wallet", ts: Date.now() },
  );
  const loaded = await store.load("s1");
  check("session encrypts+decrypts via keypair wallet", loaded?.messages[0]?.text === "hello from real keypair wallet");

  await rm(dir, { recursive: true, force: true });
  console.log(pass ? "\n✅ PASS — localWallet load/create/guard + session crypto." : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error("test error:", e);
  process.exit(1);
});
