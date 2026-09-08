import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { stopChrome } from "./chrome-process.js";

it("waits for graceful browser closure before returning", async () => {
  const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"],
  });
  const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()));
  await stopChrome(proc, closed, async () => { proc.kill(); }, 100);
  expect(proc.signalCode).not.toBeNull();
});

it.skipIf(process.platform === "win32")("stops a profile-writing helper after its launcher exits, including SIGTERM refusal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentnet-chrome-shutdown-"));
  const marker = join(dir, "writing");
  const helper = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    const write = () => { fs.mkdirSync(${JSON.stringify(dir)}, { recursive: true }); fs.writeFileSync(${JSON.stringify(marker)}, 'active'); };
    write(); setInterval(write, 5); process.send('ready');
  `;
  const launcher = `
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helper)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    child.once('message', () => process.exit(0));
  `;
  const proc = spawn(process.execPath, ["-e", launcher], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
  const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()));
  try {
    await once(proc, "exit");
    expect(proc.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(true);
    await stopChrome(proc, closed, undefined, 100);
    rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(existsSync(dir)).toBe(false);
  } finally {
    await stopChrome(proc, closed, undefined, 100);
    rmSync(dir, { recursive: true, force: true });
  }
});
