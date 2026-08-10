import { spawn } from "node:child_process";

// Getting the user's attention when they are not looking at this terminal.
//
// A terminal window gives us three escalating ways to say "your turn", and they cost
// nothing when the user IS looking:
//   1. the bell, which every dock/taskbar turns into a badge on the terminal icon
//   2. the window title, so the tab itself reads as waiting even in a tab strip
//   3. an OS notification, which is the only one that reaches another app
//
// Only the third is intrusive, so it waits: answer within the grace period and it never
// fires. There is deliberately no focus detection - reading focus events (CSI ?1004h)
// means parsing them back out of stdin, and a mis-parse injects junk into the composer.
// A delayed notification gets the same result without touching the input path.
const NOTIFY_AFTER_MS = 2500;

function osNotify(title: string, body: string): void {
  const q = (s: string) => s.replace(/["\\]/g, " ").slice(0, 180);
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

// OSC 0 sets icon+window title. Restored to the plain name once the wait is over so a
// stale "waiting" label never outlives the request.
function setTitle(t: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\u001b]0;${t}\u0007`);
}

let timer: ReturnType<typeof setTimeout> | null = null;

// Something needs the user. Rings now, re-titles now, notifies only if still unanswered.
export function callAttention(summary: string): void {
  if (!process.stdout.isTTY || process.env.AGENTNET_NO_BELL) return;
  process.stdout.write("\u0007"); // BEL → dock badge
  setTitle(`● AgentNet · ${summary}`);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    osNotify("AgentNet needs you", summary);
  }, NOTIFY_AFTER_MS);
}

// Answered (or withdrawn): cancel the pending notification and drop the title back.
export function clearAttention(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  setTitle("AgentNet");
}
