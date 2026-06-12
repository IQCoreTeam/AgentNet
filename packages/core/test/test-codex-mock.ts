import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
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
      
      // Let's trigger notifications and requests sequentially
      // 1. Send reasoning delta and final completed reasoning
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        method: "item/reasoning/textDelta",
        params: { delta: "Thinking about command..." }
      }));
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          item: {
            type: "reasoning",
            id: "r1",
            summary: ["Analyzed"],
            content: ["Thinking about command..."]
          }
        }
      }));

      // 2. Request command approval (new style)
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        id: "req-cmd-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "mock-thread-xyz",
          turnId: "turn-1",
          itemId: "item-cmd-1",
          startedAtMs: Date.now(),
          command: "echo 'hello from mock'",
          cwd: "/mock-cwd"
        }
      }));
    }
    
    // Read responses to approvals and send the next steps
    else if (msg.id === "req-cmd-1") {
      // Expected msg.result.decision = "accept" or similar.
      // Let's send command execution completed event.
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          item: {
            type: "commandExecution",
            id: "item-cmd-1",
            command: "echo 'hello from mock'",
            cwd: "/mock-cwd",
            processId: "pty-1",
            source: "user",
            status: "completed",
            commandActions: [],
            aggregatedOutput: "hello from mock\\n",
            exitCode: 0,
            durationMs: 10
          }
        }
      }));

      // 3. Request permissions approval
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        id: "req-perm-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "mock-thread-xyz",
          turnId: "turn-1",
          itemId: "item-perm-1",
          startedAtMs: Date.now(),
          cwd: "/mock-cwd",
          reason: "need internet access for test",
          permissions: {
            network: { enabled: true },
            fileSystem: null
          }
        }
      }));
    }
    
    else if (msg.id === "req-perm-1") {
      // 4. Request file change approval (new style)
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        id: "req-file-1",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "mock-thread-xyz",
          turnId: "turn-1",
          itemId: "item-file-1",
          startedAtMs: Date.now(),
          reason: "create test file",
          grantRoot: "/mock-cwd"
        }
      }));
    }
    
    else if (msg.id === "req-file-1") {
      // Send rawResponseItem completed for assistant message
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
              { type: "output_text", text: "Finished successfully!" }
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
    console.log(`[test ApprovalChannel] got request kind=${req.kind} tool=${req.tool}`);
    
    if (req.kind === "bash" && req.command === "echo 'hello from mock'") {
      return { outcome: "once" }; // accept
    }
    if (req.tool === "Permissions") {
      return { outcome: "always" }; // acceptForSession / always
    }
    if (req.tool === "Edit" && req.file === "/mock-cwd") {
      return { outcome: "once" };
    }
    return { outcome: "deny" };
  }
};

const runtime = createRuntime(wallet, storage, mockApproval);

async function main() {
  console.log("Starting Codex Mock Integration Test...");
  
  const handle = await runtime.startSession({
    cli: "codex",
    cwd: process.cwd()
  });

  const messagesReceived: any[] = [];
  handle.onMessage((msg) => {
    messagesReceived.push(msg);
    console.log(`[test msg received] role=${msg.role} text="${msg.text.trim()}"`);
  });

  const turnDone = new Promise<void>((resolve) => {
    handle.onTurnEnd(() => {
      resolve();
    });
  });

  handle.send("start mock session");
  await turnDone;
  handle.stop();

  // Clean up mock bin dir
  try {
    rmSync(mockBinDir, { recursive: true, force: true });
    rmSync(mockHome, { recursive: true, force: true });
  } catch {}

  console.log("\n--- Verification ---");
  console.log(`Total messages received: ${messagesReceived.length}`);
  console.log(`Total approvals seen: ${approvalRequestsSeen.length}`);

  // Assertions
  const gotThinking = messagesReceived.some(m => m.role === "thinking" && m.text.includes("Thinking about command..."));
  const gotToolCommand = messagesReceived.some(m => m.role === "tool" && m.tool?.name === "Bash" && m.tool?.output.includes("hello from mock"));
  const gotAssistant = messagesReceived.some(m => m.role === "assistant" && m.text === "Finished successfully!");
  
  const gotBashApproval = approvalRequestsSeen.some(a => a.kind === "bash" && a.command === "echo 'hello from mock'");
  const gotPermApproval = approvalRequestsSeen.some(a => a.tool === "Permissions");
  const gotFileApproval = approvalRequestsSeen.some(a => a.tool === "Edit" && a.file === "/mock-cwd");

  console.log(`gotThinking: ${gotThinking ? "✅" : "❌"}`);
  console.log(`gotToolCommand: ${gotToolCommand ? "✅" : "❌"}`);
  console.log(`gotAssistant: ${gotAssistant ? "✅" : "❌"}`);
  console.log(`gotBashApproval: ${gotBashApproval ? "✅" : "❌"}`);
  console.log(`gotPermApproval: ${gotPermApproval ? "✅" : "❌"}`);
  console.log(`gotFileApproval: ${gotFileApproval ? "✅" : "❌"}`);

  if (gotThinking && gotToolCommand && gotAssistant && gotBashApproval && gotPermApproval && gotFileApproval) {
    console.log("\n✅ PASS - Mock integration test succeeded!");
    process.exit(0);
  } else {
    console.error("\n❌ FAIL - Test assertions failed.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
