// One source of truth for "how do I get this engine" across every surface. Shown next
// to a missing/outdated status so the report is actionable, never a dead end. Surfaces
// run these visibly (terminal / inline with consent), never silently in the background.
//
// Pure data on purpose: browser surfaces (webview) import this module directly, so it
// must stay free of node imports (detect.ts, which reports the statuses, is node-only).
export const ENGINE_INSTALL_COMMAND: Record<"claude" | "codex", string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
};

// codex only: claude self-updates, codex (npm install) does not. An outdated codex
// silently hides new models (its models cache uses fields the old binary can't parse).
export const CODEX_UPDATE_COMMAND = "npm install -g @openai/codex@latest";
