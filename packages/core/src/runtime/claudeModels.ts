import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ChatModelOption } from "../chat/modelOptions.js";
import { resolveEngineBin } from "./engineBin.js";

// Live model catalog for the "claude" engine, pulled from the Claude Code CLI the user
// already runs. The agent SDK's query() exposes supportedModels() over its control
// channel — same auth as a normal turn, so this costs nothing extra and always reflects
// whatever the installed CLI knows (e.g. a new Sonnet appears the moment the CLI ships
// it, with no code change here). This mirrors listCodexModelOptions() for codex.
//
// Callers treat a null/empty return as "fall back to the static CHAT_MODEL_OPTIONS.claude
// baseline" — so a missing CLI, a logged-out user, or a slow probe never blocks the picker.

function modelToOption(model: ModelInfo): ChatModelOption {
  const desc = model.description?.trim();
  const displayName = model.displayName?.trim() || model.value;
  let chip = displayName;
  let full = displayName;
  // The version number lives in the DESCRIPTION ("Fable 5 · …", "Opus 5 with 1M context · …")
  // while displayName is often the bare family ("Fable", "Sonnet", "Haiku"). Prefer the
  // description's lead so the chip shows the real versioned name (Fable 5, Sonnet 5, Haiku 4.5),
  // matching the CLI's own picker — but only when it's clearly "<displayName> <version>", so a
  // distinct label like "Opus (1M context)" is left as-is.
  const lead = desc?.split(" · ")[0]?.trim(); // "Fable 5" or "Opus 5 with 1M context"
  if (model.value === "default" && lead) {
    // The CLI's "Default (recommended)" hides the real model name in its description.
    // This entry auto-follows the CLI's recommendation, so "default" is implied by it
    // being the first/selected entry — we don't spell it out. Show the plain resolved
    // model name ("Opus 5") instead of a "Default · " prefix; the picker highlight already
    // marks which entry is active.
    full = lead;
    chip = lead.split(" with ")[0].trim(); // "Opus 5"
  } else if (lead && lead.toLowerCase().startsWith(displayName.toLowerCase())) {
    // Relabel ONLY when the lead is "<family> <version>" — a version token being digits with
    // optional dotted minors ("Fable" → "Fable 5", "Haiku" → "Haiku 4.5"). Anything else after
    // the family — "Opus (1M context)", a "Sonnet Reasoning" variant — has no version token, so
    // we leave the chip as the bare family and don't invent a versioned name.
    const version = lead.slice(displayName.length).match(/^\s+(\d+(?:\.\d+)*)\b/);
    if (version) {
      const versioned = `${lead.slice(0, displayName.length)} ${version[1]}`; // family (orig case) + version
      chip = versioned;
      full = versioned;
    }
  }
  const extra = `Claude alias: ${model.value}`;
  return {
    value: model.value,
    chipLabel: chip,
    label: full,
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
      // Point at the user's installed claude, exactly like the chat spawn (spawn.ts).
      // A GUI-launched VSCode extension host has no shell PATH, so without this the SDK
      // falls back to its unresolvable bundle-relative binary, the probe fails to spawn,
      // and the picker silently drops to the static baseline (no Fable/Sonnet-1M). This
      // is why codex synced but claude didn't: codexModels resolves its path, we didn't.
      pathToClaudeCodeExecutable: resolveEngineBin("claude"),
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
    if (!models?.length) {
      console.error("[claudeModels] supportedModels() returned empty; falling back to static baseline");
      return null;
    }
    console.error(`[claudeModels] loaded ${models.length} models: ${models.map((m) => m.value).join(", ")}`);

    // No bare "default" entry: supportedModels() already lists the CLI's recommended model
    // first, so the picker defaults to it and shows its real name instead of "default".
    return models.map(modelToOption);
  } catch (e) {
    console.error(`[claudeModels] probe failed (${(e as Error)?.message || e}); falling back to static baseline`);
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    release();
    // tear down the probe subprocess; ignore teardown errors
    await q.return(undefined).catch(() => {});
  }
}
