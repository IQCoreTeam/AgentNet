import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

export interface ImageInput {
  mime: string;
  dataBase64: string;
  name?: string;
}

// Read an image off the OS clipboard. Best-effort, no dependency.
// Returns null if no image is on the clipboard or the tool isn't available.
export async function readImageFromClipboard(): Promise<ImageInput | null> {
  if (process.platform === "darwin") return readClipboardMac();
  if (process.platform === "linux") return readClipboardLinux();
  if (process.platform === "win32") return readClipboardWin();
  return null;
}

async function readClipboardMac(): Promise<ImageInput | null> {
  // Prefer pngpaste (brew install pngpaste) — pipes PNG directly to stdout.
  const direct = await runAndCapture("pngpaste", ["-"]);
  if (direct && direct.length > 0) {
    return { mime: "image/png", dataBase64: direct.toString("base64"), name: "clipboard.png" };
  }
  // Fallback: osascript writes clipboard PNG to a temp file then we read it.
  const tmp = join(tmpdir(), `agentnet-clip-${Date.now()}.png`);
  const script = `tell app "System Events" to write (the clipboard as «class PNGf») to POSIX file "${tmp}"`;
  try {
    await runAndCapture("osascript", ["-e", script]);
    const buf = await readFile(tmp).catch(() => null);
    await unlink(tmp).catch(() => {});
    if (!buf || buf.length === 0) return null;
    return { mime: "image/png", dataBase64: buf.toString("base64"), name: "clipboard.png" };
  } catch {
    return null;
  }
}

async function readClipboardLinux(): Promise<ImageInput | null> {
  const buf = await runAndCapture("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
  if (!buf || buf.length === 0) return null;
  return { mime: "image/png", dataBase64: buf.toString("base64"), name: "clipboard.png" };
}

async function readClipboardWin(): Promise<ImageInput | null> {
  const tmp = join(tmpdir(), `agentnet-clip-${Date.now()}.png`);
  const ps = `
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) { $img.Save('${tmp.replace(/\\/g, "\\\\")}') }
`;
  try {
    await runAndCapture("powershell", ["-NoProfile", "-Command", ps]);
    const buf = await readFile(tmp).catch(() => null);
    await unlink(tmp).catch(() => {});
    if (!buf || buf.length === 0) return null;
    return { mime: "image/png", dataBase64: buf.toString("base64"), name: "clipboard.png" };
  } catch {
    return null;
  }
}

function runAndCapture(cmd: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const chunks: Buffer[] = [];
      const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
      p.stdout.on("data", (d: Buffer) => chunks.push(d));
      p.on("error", () => resolve(null));
      p.on("close", (code) => {
        if (code !== 0) { resolve(null); return; }
        resolve(Buffer.concat(chunks));
      });
    } catch {
      resolve(null);
    }
  });
}

const IMAGE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// Encode an image file at the given path to an ImageInput.
// Returns null if the extension isn't a recognised image type or the file can't be read.
export async function readImageFile(path: string): Promise<ImageInput | null> {
  const mime = IMAGE_EXTS[extname(path).toLowerCase()];
  if (!mime) return null;
  try {
    const buf = await readFile(path);
    const name = path.split("/").pop() ?? path.split("\\").pop() ?? "image";
    return { mime, dataBase64: buf.toString("base64"), name };
  } catch {
    return null;
  }
}
