import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ChatModelOption } from "../chat/modelOptions.js";

// Live model catalog for the "claude" engine, pulled from the Claude Code CLI the user
// already runs. The agent SDK's query() exposes supportedModels() over its control
// channel — same auth as a normal turn, so this costs nothing extra and always reflects
// whatever the installed CLI knows (e.g. a new Sonnet appears the moment the CLI ships
// it, with no code change here). This mirrors listCodexModelOptions() for codex.
//
// Callers treat a null/empty return as "fall back to the static CHAT_MODEL_OPTIONS.claude
// baseline" — so a missing CLI, a logged-out user, or a slow probe never blocks the picker.

function modelToOption(model: ModelInfo): ChatModelOption {
  const display = model.displayName?.trim() || model.value;
  const desc = model.description?.trim();
  const extra = `Claude alias: ${model.value}`;
  return {
    value: model.value,
    chipLabel: display,
    label: display,
    description: desc ? `${desc} · ${extra}` : extra,
  };
}

export async function listClaudeModelOptions(cwd?: string): Promise<ChatModelOption[] | null> {
  // Keep the prompt stream open until we release it; supportedModels() is a control
  // request that needs the subprocess alive but does NOT need a turn to be sent.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* keepOpen(): AsyncGenerator<never> {
    await gate;
  }

  const q = query({
    prompt: keepOpen(),
    options: {
      cwd,
      // read-only probe; never runs a tool or sends a turn
      permissionMode: "default",
    },
  });

  const timeoutMs = 8000;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      reject(new Error("Timed out while loading Claude models"));
    }, timeoutMs);
  });

  try {
    const models = await Promise.race([q.supportedModels(), timeout]);
    if (!models?.length) return null;

    const options = models.map(modelToOption);
    // Prepend a "Default" entry (no --model override) mirroring the static baseline and
    // the codex picker, so the user can always fall back to the CLI's own default.
    options.unshift({
      chipLabel: "default",
      label: "Default",
      description: "CLI default · no --model override",
    });
    return options;
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    release();
    // tear down the probe subprocess; ignore teardown errors
    await q.return(undefined).catch(() => {});
  }
}
