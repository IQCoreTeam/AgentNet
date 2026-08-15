// "Web preview" memory section — a managed, auto-updated block that tells the agent, when it
// builds or runs a web app, to serve it on a loopback port in the BACKGROUND and hand the user
// the plain http://localhost:PORT link. The user opens that link in the system browser, so this
// plugin owns NO server and NO UI: it is one short hint, nothing else.
//
// It reuses the skills-section machinery wholesale (memoryFileFor + the shared spliceIntoFile
// over a marker-delimited block), so there is one splicer and one cli -> file mapping, not two.
// Injected the same way skills are (runtime/index.ts, after MemorySync.injectAtStart).
//
// GATED on AGENTNET_PREVIEW_HINT: only a surface where handing back a browser link is the actual
// UX sets it (surfaces/localhost, which serves both the desktop web app and the Android shell).
// Where the env is unset (cli, vscode, codex) the block renders empty and self-removes: an
// existing block is spliced out, and a file that never had it is left untouched (no write at
// all), so an agent there is never told to serve a preview no one can open.

import { memoryFileFor, spliceIntoFile } from "./skillsSection.js";

const START = "<!-- agentnet:preview:start -->";
const END = "<!-- agentnet:preview:end -->";

/** The managed block: the hint when this surface hands back browser links, or empty (which
 *  removes the block) when it does not. One short paragraph, no endpoint to POST, no port to
 *  track — the agent picks the port and prints the link. */
function renderBlock(enabled: boolean): string {
  if (!enabled) return "";
  const line = [
    "When you build or run a web app for the user, start its dev server in the BACKGROUND on a",
    "loopback port, then reply with the plain http://localhost:PORT link. Do not hold your turn",
    "open waiting on the server; keep it running and hand back the link. The user opens that link",
    "in the system browser to see what you built.",
  ].join("\n");
  return `${START}\n${line}\n${END}`;
}

/**
 * Update the "web preview" section for one runtime. Renders the hint ONLY when
 * AGENTNET_PREVIEW_HINT is set (the surface that hands back browser links); otherwise the
 * block is removed. Call AFTER MemorySync.injectAtStart (which regenerates the memory files),
 * alongside updateSkillsSection. Best-effort — a filesystem hiccup here must never block a
 * session, so it never throws.
 */
export async function updatePreviewSection(cli: "claude" | "codex", cwd: string): Promise<void> {
  try {
    await spliceIntoFile(memoryFileFor(cli, cwd), renderBlock(!!process.env.AGENTNET_PREVIEW_HINT), START, END);
  } catch {
    /* never throw from preview-section sync */
  }
}
