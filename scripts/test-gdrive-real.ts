// REAL Google Drive sync check. Runs the OAuth consent (opens your browser),
// then writes an encrypted session into Drive's appDataFolder, lists it, reloads
// + decrypts, and overwrites (append) to prove no-duplicate. Cleans up at the end.
// Run: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... pnpm tsx scripts/test-gdrive-real.ts

import { exec } from "node:child_process";
import { SessionStore } from "../src/account/store.js";
import { gdriveStorage } from "../src/account/storage/gdrive.js";
import { googleLogin, isSignedIn } from "../src/account/storage/oauth.js";
import { testWallet } from "../src/account/keypairWallet.js";

// open a URL in the default browser (macOS `open`)
const openBrowser = (url: string) => {
  console.log("\n  → opening Google consent in your browser...");
  console.log("    (if it doesn't open, paste this:)\n   ", url, "\n");
  exec(`open "${url}"`);
};

async function main() {
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.error("Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET env first.");
    process.exit(1);
  }

  if (!(await isSignedIn())) {
    console.log("→ not signed in — starting Google OAuth (loopback + PKCE)");
    await googleLogin(openBrowser);
    console.log("  ✅ signed in, token saved locally (~/.agentnet/tokens/google.json)");
  } else {
    console.log("→ already signed in (using stored token)");
  }

  const wallet = testWallet(7);
  const storage = gdriveStorage();
  const store = new SessionStore(wallet, storage);
  const id = "gdrive-real-check";

  console.log("→ writing encrypted session to Drive appDataFolder...");
  const meta = { sessionId: id, cli: "claude" as const, title: "gdrive sync check", ts: Date.now() };
  await store.appendMessage(meta, { role: "user", text: "does this reach Google Drive?", ts: Date.now() });
  await store.appendMessage(meta, { role: "assistant", text: "yes — synced to Drive appDataFolder", ts: Date.now() });

  const ids = await storage.list();
  console.log(`  ✅ list() from Drive: ${ids.length} session(s) — includes ours: ${ids.includes(id)}`);

  const reloaded = await new SessionStore(wallet, storage).load(id);
  console.log(`  ✅ reloaded + decrypted from Drive: ${reloaded?.messages.length} messages`);

  // append again → must update same file (no duplicate)
  await store.appendMessage(meta, { role: "user", text: "second turn", ts: Date.now() });
  const after = await new SessionStore(wallet, storage).load(id);
  const idsAfter = await storage.list();
  const dupCount = idsAfter.filter((x) => x === id).length;
  console.log(`  ✅ after append: ${after?.messages.length} msgs, file count for id = ${dupCount} (expect 1)`);

  // cleanup
  await storage.remove(id);
  console.log("  ✅ cleaned up (removed test file from Drive)");

  const ok = reloaded?.messages.length === 2 && (after?.messages.length ?? 0) === 3 && dupCount === 1;
  console.log(ok ? "\n✅ PASS — real Google Drive write/list/reload/append-no-dup works." : "\n❌ FAIL");
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error("error:", e); process.exit(1); });
