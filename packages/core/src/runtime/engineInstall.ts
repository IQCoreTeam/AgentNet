// One source of truth for "how do I get this engine" across every surface. Shown next
// to a missing/outdated status so the report is actionable, never a dead end. Surfaces
// run these visibly (terminal / inline with consent), never silently in the background.
//
// Pure data on purpose: browser surfaces (webview) import this module directly, so it
// must stay free of node imports (detect.ts, which reports the statuses, is node-only).
export const NODE_REQUIRED_MESSAGE = "This engine is installed, but Node.js is missing. Install Node.js, restart AgentNet, then retry.";
export const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

export const ENGINE_INSTALL_COMMAND: Record<"claude" | "codex", string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
};

// Official npm update command per engine, the same channel as the install commands.
// updateEngine in engineVersions.ts runs it only for a missing engine; an installed engine
// updates itself.
export const ENGINE_UPDATE_COMMAND: Record<"claude" | "codex", string> = {
  codex: "npm install -g @openai/codex@latest",
  claude: "npm install -g @anthropic-ai/claude-code@latest",
};

// An outdated codex silently hides new models (its models cache uses fields the old
// binary can't parse), so it gets its own update notice in the VS Code surface.
// Let Codex select the updater for its install method instead of installing a second
// npm copy beside a standalone or Homebrew installation.
export const CODEX_UPDATE_COMMAND = "codex update";

// True when a < b, comparing dotted numeric parts; a prerelease suffix is ignored on
// purpose (both CLIs ship plain x.y.z releases). Lives here (not engineVersions.ts)
// because browser surfaces need it and this module must stay node-free.
export function isVersionOlder(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}
