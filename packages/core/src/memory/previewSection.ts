// "In-app preview" memory section — a managed, auto-updated block that tells the agent the
// AgentNet app has a PREVIEW tab, so when it builds/runs a web app it should serve it on a
// loopback port and hand the user the http://localhost:PORT link (which the chat turns into a
// one-tap preview). Mirrors skillsSection.ts: a SETTER over a marker-delimited block, spliced
// into claude's MEMORY.md / codex's AGENTS.md, injected every session — no system-prompt nudge.
//
// GATED on AGENTNET_PREVIEW_PORT: only the surface that actually HAS the preview tab + announce
// endpoint (surfaces/localhost, incl. the Android app) sets it. On the CLI/VSCode surfaces the
// env is unset → the block renders empty: an existing block is spliced out, and a file without
// our markers is left untouched (no write at all), so an agent there is never told to hit an
// endpoint that doesn't exist.

import { memoryFileFor, spliceIntoFile } from "./skillsSection.js";

const START = "<!-- agentnet:preview:start -->";
const END = "<!-- agentnet:preview:end -->";

function renderBlock(port: string | null): string {
  if (!port) return ""; // no preview surface → remove the block entirely
  const line = [
    "In-app preview: this app has a PREVIEW tab that frames a local web server in an iframe.",
    "When you build or run a web app for the user, start its dev server in the BACKGROUND on a",
    "loopback port, then give the user the plain http://localhost:PORT link in your reply — it",
    'becomes a one-tap "open preview" button. (Optional: POST',
    `http://127.0.0.1:${port}/preview/announce with {"port":N} to open it directly, {"port":null} to clear.)`,
  ].join("\n");
  return `${START}\n${line}\n${END}`;
}

/**
 * Update the "in-app preview" section for one runtime. Renders the hint ONLY when
 * AGENTNET_PREVIEW_PORT is set (the surface with the PREVIEW tab); otherwise removes the block.
 * Call AFTER MemorySync.injectAtStart (which regenerates the files). Best-effort — never throws.
 */
export async function updatePreviewSection(cli: "claude" | "codex", cwd: string): Promise<void> {
  try {
    const port = process.env.AGENTNET_PREVIEW_PORT || null;
    await spliceIntoFile(memoryFileFor(cli, cwd), renderBlock(port), START, END);
  } catch {
    /* never throw from preview-section sync */
  }
}
