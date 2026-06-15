import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { createRuntime } from "../src/runtime/index.js";
import { manualStorage } from "../src/account/storage/manual.js";
import { testWallet } from "../src/account/keypairWallet.js";
import type { ApprovalRequest, ApprovalDecision } from "../src/runtime/approval/channel.js";

// Setup unique temp storage for agentnet home so it doesn't collide
const mockHome = join(tmpdir(), "agentnet-mock-home-" + process.pid);
process.env.AGENTNET_HOME = mockHome;

// Create a mock executable directory and put it at the front of PATH
const mockBinDir = mkdtempSync(join(tmpdir(), "agentnet-mock-bin-"));
const mockBinPath = join(mockBinDir, "codex");

// A wrapper node script that acts as the codex CLI
const mockCodexScript = `#!/usr/bin/env node
const readline = require('readline');

// Standard handshake/startup
console.log(JSON.stringify({ jsonrpc: "2.0", method: "thread/started", params: { threadId: "mock-thread-xyz" } }));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    
    // Auto-respond to initialize
    if (msg.method === "initialize") {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    }
    
    // Auto-respond to thread/start or resume
    else if (msg.method === "thread/start" || msg.method === "thread/resume") {
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { thread: { id: "mock-thread-xyz" } }
      }));
    }
    
    // When turn starts, we run our scripted assertions
    else if (msg.method === "turn/start") {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
      
      // Let's trigger a command approval request
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        id: "req-cmd-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "mock-thread-xyz",
          turnId: "turn-1",
          itemId: "item-cmd-1",
          startedAtMs: Date.now(),
          command: "npm run test",
          cwd: "/mock-cwd"
        }
      }));
    }
    
    // Read responses to approvals
    else if (msg.id === "req-cmd-1") {
      // Send rawResponseItem completed for assistant message with a multi-file diff
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        method: "rawResponseItem/completed",
        params: {
          threadId: "mock-thread-xyz",
          turnId: "turn-1",
          item: {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "Finished turn successfully!" }
            ]
          }
        }
      }));
      
      // End the turn
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: "mock-thread-xyz",
          turn: {
            id: "turn-1",
            status: "completed"
          }
        }
      }));
    }
  } catch (e) {
    // Avoid printing to stderr
  }
});
`;

writeFileSync(mockBinPath, mockCodexScript, "utf8");
chmodSync(mockBinPath, 0o755);

// Prepend to PATH so child_process.spawn("codex") picks up our mock
process.env.PATH = mockBinDir + ":" + process.env.PATH;

// Setup agent runtime
const wallet = testWallet();
const storage = manualStorage();

// Custom mock ApprovalChannel
let approvalRequestsSeen: ApprovalRequest[] = [];
const mockApproval = {
  request: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
    approvalRequestsSeen.push(req);
    console.log(`[test ApprovalChannel] got request kind=${req.kind} command=${req.command}`);
    
    if (req.kind === "bash" && req.command === "npm run test") {
      return { outcome: "always" }; // always allow and persist whitelist
    }
    return { outcome: "deny" };
  }
};

const runtime = createRuntime(wallet, storage, mockApproval);

async function main() {
  console.log("Starting Codex Mock Integration Test for Claude-Polish...");

  // Verify Config file starts clean or empty
  const configFilePath = join(mockHome, "config.json");
  console.log(`Config file exists before first run: ${existsSync(configFilePath)}`);

  console.log("\n--- SESSION 1: Always Allow a command (should save to disk) ---");
  const handle1 = await runtime.startSession({
    cli: "codex",
    cwd: process.cwd()
  });

  const turnDone1 = new Promise<void>((resolve) => handle1.onTurnEnd(resolve));
  handle1.send("first prompt");
  await turnDone1;
  handle1.stop();

  console.log(`Config file exists after first run: ${existsSync(configFilePath)}`);

  // Verify that the command request was captured once in Session 1
  const s1Count = approvalRequestsSeen.length;
  console.log(`Approvals seen in Session 1: ${s1Count}`);

  console.log("\n--- SESSION 2: Run same command (should bypass prompt using disk whitelist) ---");
  const handle2 = await runtime.startSession({
    cli: "codex",
    cwd: process.cwd()
  });

  const turnDone2 = new Promise<void>((resolve) => handle2.onTurnEnd(resolve));
  handle2.send("second prompt");
  await turnDone2;
  handle2.stop();

  // Clean up mock bin dir
  try {
    rmSync(mockBinDir, { recursive: true, force: true });
    rmSync(mockHome, { recursive: true, force: true });
  } catch {}

  const s2Count = approvalRequestsSeen.length - s1Count;
  console.log(`Approvals seen in Session 2: ${s2Count}`);

  console.log("\n--- Verification ---");
  console.log(`Session 1 Approvals (expecting 1): ${s1Count}`);
  console.log(`Session 2 Approvals (expecting 0 due to whitelist bypass): ${s2Count}`);

  const persistentWhitelistPassed = s1Count === 1 && s2Count === 0;

  if (persistentWhitelistPassed) {
    console.log("\n✅ PASS - Mock persistent whitelist test succeeded!");
    process.exit(0);
  } else {
    console.error("\n❌ FAIL - Whitelist bypass did not happen.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
