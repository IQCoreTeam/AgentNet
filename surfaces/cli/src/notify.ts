import { spawn, type ChildProcess } from "node:child_process";

// Getting the user's attention when they are not looking at this terminal.
//
// A terminal window gives us escalating ways to say "your turn", and they cost
// nothing when the user IS looking:
//   1. the bell, which every dock/taskbar turns into a badge on the terminal icon
//   2. the window title, so the tab itself reads as waiting even in a tab strip
//   3. after a grace period, something that reaches another app: on macOS an actual
//      dialog with Approve/Deny buttons (the vscode surface's modal, translated),
//      elsewhere an OS notification
//
// Only the third is intrusive, so it waits: answer within the grace period and it never
// fires. There is deliberately no focus detection - reading focus events (CSI ?1004h)
// means parsing them back out of stdin, and a mis-parse injects junk into the composer.
// A delayed escalation gets the same result without touching the input path.
const NOTIFY_AFTER_MS = 2500;

// AppleScript string literal: no quotes, no backslashes, no raw newlines.
const q = (s: string) => s.replace(/["\\]/g, " ").replace(/\s+/g, " ").slice(0, 180);

function osNotify(title: string, body: string): void {
  try {
    if (process.platform === "darwin") {
      spawn("osascript", ["-e", `display notification "${q(body)}" with title "${q(title)}"`], {
        stdio: "ignore",
        detached: true,
      }).unref();
    } else if (process.platform === "win32") {
      spawn(
        "powershell",
        ["-NoProfile", "-Command", `[console]::beep(880,200)`],
        { stdio: "ignore", detached: true },
      ).unref();
    } else {
      spawn("notify-send", [q(title), q(body)], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    /* no notifier on this box — the bell and the title already did their job */
  }
}

// OSC 9 asks the terminal itself to post the notification (iTerm2/WezTerm/Ghostty/kitty).
// It arrives under the terminal's own app identity, so it still works where osascript's
// "Script Editor" identity is denied in the OS notification settings. Terminals that
// don't know OSC 9 ignore the sequence. Control characters are stripped from the body
// so a summary can never terminate or extend the escape; under tmux the sequence rides
// a DCS "tmux;" passthrough (ESC doubled) to the outer terminal — needs
// allow-passthrough on tmux >= 3.3, and degrades to nothing (not junk) where it's off.
function termNotify(body: string): void {
  if (!process.stdout.isTTY) return;
  const clean = body.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 180);
  const seq = `\u001b]9;${clean}\u0007`;
  process.stdout.write(
    process.env.TMUX
      ? `\u001bPtmux;${seq.replace(/\u001b/g, "\u001b\u001b")}\u001b\\`
      : seq,
  );
}

// The actionable tier: a real macOS dialog with Approve/Deny buttons, like the vscode
// surface's modal (approvalNotify.ts). Clicking resolves the approval without touching
// the terminal. Only "once" and "deny" are offered — "always" grants standing permission
// and belongs on the full card where the command/diff is visible.
let dialog: ChildProcess | null = null;

function showDialog(summary: string, onDecision: (approve: boolean) => void): void {
  const script =
    `display dialog "${q(summary)}" with title "AgentNet approval" ` +
    `buttons {"Deny", "Approve"} default button "Approve" giving up after 240`;
  try {
    const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    dialog = child;
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("exit", () => {
      if (dialog === child) dialog = null;
      // "gave up:true" = the 240s timeout, not an answer. Killed (answered in the
      // terminal first) exits with no output. Neither may decide anything.
      if (out.includes("gave up:true")) return;
      if (out.includes("button returned:Approve")) onDecision(true);
      else if (out.includes("button returned:Deny")) onDecision(false);
    });
    child.on("error", () => {
      if (dialog === child) dialog = null;
      osNotify("AgentNet needs you", summary);
    });
  } catch {
    osNotify("AgentNet needs you", summary);
  }
}

// OSC 0 sets icon+window title. Restored to the plain name once the wait is over so a
// stale "waiting" label never outlives the request.
function setTitle(t: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\u001b]0;${t}\u0007`);
}

let timer: ReturnType<typeof setTimeout> | null = null;

// Something needs the user. Rings now, re-titles now, escalates only if still unanswered.
// When onDecision is given (an approval), the macOS escalation is a clickable dialog;
// without it (or off-mac) it's a passive notification.
export function callAttention(summary: string, onDecision?: (approve: boolean) => void): void {
  if (!process.stdout.isTTY || process.env.AGENTNET_NO_BELL) return;
  process.stdout.write("\u0007"); // BEL → dock badge
  setTitle(`● AgentNet · ${summary}`);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    termNotify(`AgentNet needs you: ${summary}`);
    if (process.platform === "darwin" && onDecision) showDialog(summary, onDecision);
    else osNotify("AgentNet needs you", summary);
  }, NOTIFY_AFTER_MS);
}

// Answered (or withdrawn): cancel the pending escalation, close a live dialog, and drop
// the title back.
export function clearAttention(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (dialog) {
    dialog.kill();
    dialog = null;
  }
  setTitle("AgentNet");
}
