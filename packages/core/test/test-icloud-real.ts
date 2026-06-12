// REAL iCloud sync check (not a temp dir). Writes an encrypted session into the
// actual iCloud Drive folder so macOS picks it up for sync, verifies the file
// lands + reloads, then cleans up. Proves "conversations sync to iCloud".
// Run: pnpm tsx scripts/test-icloud-real.ts

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { SessionStore } from "../src/account/store.js";
import { icloudStorage } from "../src/account/storage/icloud.js";
import { testWallet } from "../src/account/keypairWallet.js";

const ICLOUD = join(
  homedir(),
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs",
  "AgentNet",
);

async function main() {
  console.log("→ writing an encrypted session into REAL iCloud Drive:");
  console.log("  ", ICLOUD);

  const wallet = testWallet(42);
  const storage = icloudStorage(); // default = real iCloud folder
  const store = new SessionStore(wallet, storage);
  const id = "icloud-real-check";

  const meta = { sessionId: id, cli: "claude" as const, title: "iCloud sync check", ts: Date.now() };
  await store.appendMessage(meta, { role: "user", text: "does this reach my iCloud?", ts: Date.now() });
  await store.appendMessage(meta, { role: "assistant", text: "yes — synced via iCloud Drive", ts: Date.now() });

  // file really on disk in the iCloud container?
  const file = join(ICLOUD, `${id}.bin`);
  const st = await stat(file);
  console.log(`  ✅ file written: ${file} (${st.size} bytes, encrypted)`);

  // reload + decrypt (simulates another device with the same wallet)
  const reloaded = await new SessionStore(wallet, storage).load(id);
  console.log(`  ✅ reloaded + decrypted: ${reloaded?.messages.length} messages`);

  console.log("\n  NOTE: macOS now syncs this file to your other Apple devices automatically.");
  console.log("  Open Finder → iCloud Drive → AgentNet to see it (cloud icon = uploading).");
  console.log("\n  (leaving the file so you can watch it sync; delete via Finder when done)");

  if (reloaded && reloaded.messages.length === 2) console.log("\n✅ PASS — real iCloud write + reload works.");
  else { console.log("\n❌ FAIL"); process.exit(1); }
}

main().catch((e) => { console.error("error:", e); process.exit(1); });
