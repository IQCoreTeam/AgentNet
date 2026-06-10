// canonical session -> Claude Code native jsonl (the INJECT direction; the
// reverse of convert/claude.ts). Writes ~/.claude/projects/{hash}/{uuid}.jsonl so
// `claude --resume <uuid>` continues the same conversation.
//
// VERIFIED on claude 2.1.168: a session is recognized only when the cwd->dir hash
// matches AND user/assistant lines form a strict uuid linked list (parentUuid
// chains to the previous line). Crucially, the ASSISTANT line must carry the FULL
// message shape (model, id, stop_reason, usage) — a stripped-down assistant line is
// accepted by --resume but then HANGS on the next turn. So we mirror the real shape.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage } from "../contract.js";
import { claudeProjectDir, ensureDir } from "../../core/paths.js";

export interface InjectClaudeOpts {
  nativeUuid: string; // = filename stem = each line's sessionId
  cwd: string; // must match the resume cwd (drives the project dir hash)
  messages: ChatMessage[]; // canonical, oldest->newest, already filtered to user/assistant
  version?: string;
  gitBranch?: string;
}

export async function injectClaude(o: InjectClaudeOpts): Promise<void> {
  const dir = claudeProjectDir(o.cwd);
  await ensureDir(dir);

  const base = {
    isSidechain: false,
    userType: "external" as const,
    cwd: o.cwd,
    sessionId: o.nativeUuid,
    version: o.version ?? "2.1.168",
    gitBranch: o.gitBranch ?? "",
  };

  let parentUuid: string | null = null; // strict chain: each line points at the previous
  const lines = o.messages.map((m) => {
    const uuid = randomUUID();
    const timestamp = new Date(m.ts).toISOString();
    const line =
      m.role === "assistant"
        ? {
            parentUuid,
            requestId: "req_" + uuid.replace(/-/g, "").slice(0, 16),
            type: "assistant",
            message: {
              model: "claude-opus-4-8",
              id: "msg_" + uuid.replace(/-/g, "").slice(0, 24),
              type: "message",
              role: "assistant",
              content: [{ type: "text", text: m.text }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
            uuid,
            timestamp,
            entrypoint: "cli",
            ...base,
          }
        : {
            parentUuid,
            promptId: "p_" + uuid.replace(/-/g, "").slice(0, 16),
            type: "user",
            message: { role: "user", content: [{ type: "text", text: m.text }] },
            uuid,
            timestamp,
            permissionMode: "default",
            promptSource: "user",
            entrypoint: "cli",
            ...base,
          };
    parentUuid = uuid;
    return JSON.stringify(line);
  });

  // overwrite (truncate): canonical is source of truth; this projection is rebuilt
  // every resume so turns from the other cli are reflected.
  await writeFile(join(dir, `${o.nativeUuid}.jsonl`), lines.join("\n") + "\n");
}
