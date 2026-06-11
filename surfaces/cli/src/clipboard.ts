import { spawn } from "node:child_process";

// Copy text to the OS clipboard via the platform tool — no dependency. Best-effort:
// returns false if the tool isn't present.
export function copyToClipboard(text: string): Promise<boolean> {
  const cmd =
    process.platform === "darwin"
      ? "pbcopy"
      : process.platform === "win32"
        ? "clip"
        : "xclip"; // linux (needs xclip / falls through to false)
  const args = cmd === "xclip" ? ["-selection", "clipboard"] : [];
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
      p.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}
