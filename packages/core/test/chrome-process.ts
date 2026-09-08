import type { ChildProcess } from "node:child_process";

// The caller launches Chrome with detached: true on POSIX. Its process group is
// private to this test, including helpers left behind by a launcher script.
export async function stopChrome(proc: ChildProcess, closed: Promise<void>, closeBrowser?: () => Promise<unknown>, timeoutMs = 2_000): Promise<void> {
  async function wait(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([closed.then(() => true), new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  function signal(signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, signal);
      else if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
  }
  if (closeBrowser) {
    // Browser.close can close the CDP socket without returning a response.
    void closeBrowser().catch(() => {});
    if (await wait()) return;
  }
  signal("SIGTERM");
  if (await wait()) return;
  signal("SIGKILL");
  if (!await wait()) throw new Error("Chrome did not close; preserving its test profile");
}
