// createChatSession (the dispatcher) over a FAKE transport — the exact path the
// server/webview use. Guards the ready+send ordering: the dispatcher must run handlers
// in arrival order, or ready's open() kills the handle send just spawned → empty turn.
// Run: tsx test/test-dispatch.ts   (needs claude installed & logged in)
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AGENTNET_HOME = join(tmpdir(), "agentnet-dispatch-" + process.pid);

import { createRuntime } from "../src/runtime/index.js";
import { manualStorage } from "../src/account/storage/manual.js";
import { testWallet } from "../src/account/keypairWallet.js";
import { createChatSession } from "../src/chat/session.js";
import { TransportApprovalChannel } from "../src/chat/approvalChannel.js";

const wallet = testWallet();
const storage = manualStorage();
const runtime = createRuntime(wallet, storage);

// a fake transport: collect what the dispatcher SENDS, and let us push UI messages IN
const recvCbs: ((m: any) => void)[] = [];
const sent: any[] = [];
const transport = {
  send: (m: any) => { sent.push(m); },
  onRecv: (cb: (m: any) => void) => { recvCbs.push(cb); },
};
function fromUI(m: any) { for (const cb of recvCbs) cb(m); }

const approval = new TransportApprovalChannel(transport);

const chat = createChatSession(runtime, transport, {
  cwd: () => process.cwd(),
  approval,
  walletAddress: () => wallet.address,
  storageInfo: async () => ({ info: { connected: false, kind: "local" }, options: [] }),
});

// auto-answer any approval card the dispatcher emits (mirror the WS test)
const origSend = transport.send;
transport.send = (m: any) => {
  origSend(m);
  if (m.type === "approval") fromUI({ type: "approvalDecision", id: m.req.id, outcome: "once" });
};

let gotAssistant = "";
const turnEnded = new Promise<void>((resolve) => {
  const origSend2 = transport.send;
  transport.send = (m: any) => {
    origSend2(m);
    if (m.type === "message" && m.msg?.role === "assistant") gotAssistant += m.msg.text;
    if (m.type === "turnEnd" && gotAssistant) resolve(); // first turn that produced text
  };
});

// THE REGRESSION: fire ready+send back-to-back, no gap. The dispatcher must process
// them in order — ready's open() runs to completion BEFORE send spawns a handle.
// If the two race (the old bug), ready's open() stops the handle send just made and
// the turn comes back empty. A real surface (reconnect, automation) sends them this
// way, so this is the exact shape that has to work.
fromUI({ type: "ready" });
fromUI({ type: "send", text: "Reply with exactly the word PONG and nothing else." });

const timeout = new Promise<void>((r) => setTimeout(r, 40000));
await Promise.race([turnEnded, timeout]);

console.log("  sent types:", [...new Set(sent.map((s) => s.type))].join(", "));
console.log("  assistant text:", JSON.stringify(gotAssistant.slice(0, 120)));
const ok = gotAssistant.trim().length > 0;
console.log(ok
  ? "✅ PASS — dispatcher serializes ready+send; the turn produces a real reply"
  : "❌ FAIL — empty turn (ready/send raced and killed the handle)");

chat.stop();
process.exit(ok ? 0 : 1);
