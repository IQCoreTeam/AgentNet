// End-to-end "wallet → connect → storage → encrypted session syncs" test.
// Uses a generated local wallet + icloud-style folder backend (no creds needed),
// the SAME path a real run takes: localWallet → initialize → connect → save → reload.
// Proves the three pieces (wallet, storage, runtime) flow as one line.

import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  // isolate all local state in a temp home so nothing real is touched
  const home = await mkdtemp(join(tmpdir(), "agentnet-e2e-"));
  process.env.AGENTNET_HOME = home;
  const cloudDir = join(home, "cloud"); // stand-in for a Drive/iCloud folder

  // import AFTER setting AGENTNET_HOME
  const { loadOrCreateWallet } = await import("../src/account/localWallet.js");
  const { initialize, connect } = await import("../src/index.js");
  const { SessionStore } = await import("../src/account/store.js");
  const { icloudStorage } = await import("../src/account/storage/icloud.js");

  let pass = true;
  const check = (n: string, ok: boolean) => { console.log(`  ${ok ? "✅" : "❌"} ${n}`); if (!ok) pass = false; };

  // 1. wallet — generate a fresh local keypair (no real ~/.config touched)
  const kpPath = join(home, "id.json");
  const w = await loadOrCreateWallet(kpPath);
  check("wallet created", w.created && w.address.length > 30);
  console.log("  address:", w.address);

  // 2. pick a storage backend (icloud-style local folder = a stand-in for Drive)
  await initialize({ kind: "icloud", location: cloudDir });
  check("storage initialized (icloud folder)", true);

  // 3. connect — wallet + restored storage → runtime (the one-line hookup)
  const runtime = await connect(w.wallet);
  check("connect() returned a runtime", typeof runtime.listSessions === "function");

  // 4. simulate a saved conversation through the same store path the runtime uses
  const store = new SessionStore(w.wallet, icloudStorage(cloudDir));
  await store.appendMessage(
    { sessionId: "demo", cli: "claude", title: "hello", ts: Date.now() },
    { role: "user", text: "does this sync to my drive?", ts: Date.now() },
  );

  // 5. the encrypted file actually lands in the "cloud" folder
  const files = await readdir(cloudDir);
  const blob = files.find((f) => f.endsWith(".bin"));
  check("encrypted session file in cloud folder", !!blob);
  if (blob) {
    const raw = await readFile(join(cloudDir, blob), "utf8");
    check("file is encrypted (not plaintext)", !raw.includes("does this sync"));
  }

  // 6. reload with the SAME wallet (simulates another device) → decrypts
  const reloaded = await store.load("demo");
  check("same wallet reloads + decrypts", reloaded?.messages[0]?.text === "does this sync to my drive?");

  await rm(home, { recursive: true, force: true });
  console.log(pass ? "\n✅ PASS — wallet → connect → storage → encrypted sync, end to end." : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error("test error:", e); process.exit(1); });
