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

// Only user/assistant turns are reconstructable as native history. thinking is
// provider-internal (codex stores it encrypted); tool needs matched call_ids we
// can't fabricate. Dropping them keeps the injected log schema-clean.
function replayable(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === "user" || m.role === "assistant");
}

export async function prepareResume(
  store: SessionStore,
  cli: Cli,
  cwd: string,
  canonicalId: string,
): Promise<string> {
  const canon = await store.load(canonicalId);
  const messages = replayable(canon?.messages ?? []);

  // The canonical id IS the native id for the cli that birthed the session.
  const birthCli = canon?.cli;
  let nativeId = birthCli === cli ? canonicalId : await getNativeId(canonicalId, cli);
  if (!nativeId) {
    nativeId = randomUUID(); // codex accepts a v4 uuid; claude uses it as the filename
    await setNativeId(canonicalId, cli, nativeId);
  }

  if (cli === "claude") {
    await injectClaude({ nativeUuid: nativeId, cwd, messages });
  } else {
    await injectCodex({ threadId: nativeId, cwd, messages });
  }
  return nativeId;
}
