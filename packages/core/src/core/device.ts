import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { hostname, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { deviceFile, ensureDir, rootDir } from "./paths.js";

interface DeviceData {
  id: string;
}

let cachedProfile: { id: string; label: string } | null = null;

export async function getDeviceProfile(): Promise<{ id: string; label: string }> {
  if (cachedProfile) {
    return cachedProfile;
  }

  const file = deviceFile();
  let id: string = "";

  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as DeviceData;
      if (data && typeof data.id === "string") {
        id = data.id;
      }
    } catch {
      // ignore JSON parse/read errors and generate new UUID
    }
  }

  if (!id) {
    id = randomUUID();
    await ensureDir(rootDir());
    try {
      writeFileSync(file, JSON.stringify({ id }, null, 2), { mode: 0o600, encoding: "utf8" });
    } catch (e) {
      console.error("Failed to write device file:", e);
    }
  }

  const label = process.env.AGENTNET_DEVICE_LABEL || `${hostname()} (${platform()})`;

  cachedProfile = { id, label };
  return cachedProfile;
}

export function buildDeviceNotice(
  prev: { id: string; label: string },
  cur: { id: string; label: string },
): string {
  const prevShort = prev.id.slice(0, 8);
  const curShort = cur.id.slice(0, 8);
  return (
    `[device] This session last ran on "${prev.label}" (${prevShort}).\n` +
    `Absolute paths and "already installed" notes in the history may belong to that machine. ` +
    `Verify on THIS device ("${cur.label}", ${curShort}) before relying on them.`
  );
}

export function _clearCache(): void {
  cachedProfile = null;
}
