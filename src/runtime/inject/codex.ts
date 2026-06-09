// canonical session -> Codex CLI native jsonl (the INJECT direction; reverse of
// convert/codex.ts). Writes ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<id>.jsonl
// so `codex exec resume <id>` continues the same conversation.
//
// VERIFIED on codex 0.137.0: a file of just session_meta + response_item(message)
// lines is enough — base_instructions, event_msg and turn_context are runtime
// echoes and can be omitted. Codex finds the session by UUID by SCANNING the tree
// and FILTERS by cwd (unless --all), so payload.cwd must equal the resume cwd.
// Content-type is asymmetric: user/developer -> input_text, assistant -> output_text.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage } from "../contract.js";
import { codexSessionsDir, ensureDir } from "../../core/paths.js";

export interface InjectCodexOpts {
  threadId: string; // any v4 UUID is accepted (verified); also embedded in filename
  cwd: string; // MUST match the resume cwd (codex cwd-filters on resume)
  messages: ChatMessage[]; // canonical, oldest->newest, filtered to user/assistant
  cliVersion?: string;
}

// "2026-06-09T14-43-14" — codex's filename timestamp form (dashes, not colons).
function fileStamp(iso: string): string {
  return iso.slice(0, 19).replace(/:/g, "-");
}

export async function injectCodex(o: InjectCodexOpts): Promise<void> {
  const firstTs = o.messages[0]?.ts ?? o.messages[o.messages.length - 1]?.ts ?? 0;
  const iso = new Date(firstTs).toISOString();
  const [y, mo, d] = iso.slice(0, 10).split("-");
  const dir = join(codexSessionsDir(), y, mo, d);
  await ensureDir(dir);

  const meta = {
    timestamp: iso,
    type: "session_meta",
    payload: {
      id: o.threadId,
      timestamp: iso,
      cwd: o.cwd,
      originator: "codex_exec",
      cli_version: o.cliVersion ?? "0.137.0",
      source: "exec",
      thread_source: "user",
      model_provider: "openai",
    },
  };

  const items = o.messages.map((m) => ({
    timestamp: new Date(m.ts).toISOString(),
    type: "response_item",
    payload: {
      type: "message",
      role: m.role, // "user" | "assistant"
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: m.text,
        },
      ],
    },
  }));

  const lines = [meta, ...items].map((l) => JSON.stringify(l));
  await writeFile(
    join(dir, `rollout-${fileStamp(iso)}-${o.threadId}.jsonl`),
    lines.join("\n") + "\n",
  );
}
