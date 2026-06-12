// prepareResume — the resume-path glue. Given a CANONICAL session id and the
// target cli, it:
//   1. loads the canonical messages (SessionStore.load — reused, was uncalled)
//   2. resolves or MINTS the native id for that cli (idmap)
//   3. rewrites the history into that cli's native jsonl (inject/{claude,codex})
//   4. returns the NATIVE id to hand to the spawned process as its --resume target
//
// The canonical id stays the storage key (index.ts keeps appending new turns under
// it); only the process resumes under the native id. That split is what makes a
// claude-born session continue in codex and vice versa.

import { randomUUID } from "node:crypto";
import type { SessionStore } from "../../account/store.js";
import type { ChatMessage } from "../contract.js";
import { getNativeId, setNativeId } from "./idmap.js";
import { injectClaude } from "./claude.js";
import { injectCodex } from "./codex.js";

type Cli = "claude" | "codex";

// Turn the canonical log into the messages to rebuild as native history.
//
// COMPACTION (cross-CLI, platform-neutral): a role:"summary" record means the turns
// before it were compacted into that text. We honor the LAST summary — drop every
// turn at/before what it subsumes and fold the summary in as a leading user note
// ("[Summary of earlier conversation] …"). This is the universal fold-in: the target
// CLI just receives the summary as text, so it works even for an engine (or a future
// platform) with no native compaction concept. A codex /compact and a claude /compact
// both normalized to the same summary record, so either side reads the other's.
//
// Plain turns: only user/assistant are reconstructable (thinking is provider-internal;
// tool needs matched call_ids we can't fabricate) — those are dropped.
function replayable(messages: ChatMessage[]): ChatMessage[] {
  let lastSummary = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "summary") { lastSummary = i; break; }
  }

  if (lastSummary < 0) {
    return messages.filter((m) => m.role === "user" || m.role === "assistant");
  }

  const summary = messages[lastSummary];
  // turns after the summary (the ones it did NOT subsume) stay verbatim
  const after = messages
    .slice(lastSummary + 1)
    .filter((m) => m.role === "user" || m.role === "assistant");
  // the summary becomes the opening context
  const folded: ChatMessage = {
    role: "user",
    text: "[Summary of earlier conversation]\n" + summary.text,
    ts: summary.ts,
  };
  return [folded, ...after];
}

export async function prepareResume(
  store: SessionStore,
  cli: Cli,
  cwd: string,
  canonicalId: string,
  ephemeral?: boolean,
): Promise<string> {
  const canon = await store.load(canonicalId);
  const messages = replayable(canon?.messages ?? []);

  // The canonical id IS the native id for the cli that birthed the session.
  const birthCli = canon?.cli;
  let nativeId = ephemeral
    ? randomUUID()
    : (birthCli === cli ? canonicalId : await getNativeId(canonicalId, cli));
  if (!ephemeral && !nativeId) {
    nativeId = randomUUID(); // codex accepts a v4 uuid; claude uses it as the filename
    await setNativeId(canonicalId, cli, nativeId);
  }
  const resolvedId = nativeId!;

  if (cli === "claude") {
    await injectClaude({ nativeUuid: resolvedId, cwd, messages });
  } else {
    await injectCodex({ threadId: resolvedId, cwd, messages });
  }
  return resolvedId;
}
