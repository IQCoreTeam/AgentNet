import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { spawnEngine, spawnClaudeProcess } from "./engineProcess.js";

const home = mkdtempSync(join(tmpdir(), "agentnet-launch-"));
const binDir = join(home, "engine install (226)");
mkdirSync(binDir);
const entry = join(binDir, "probe.cjs");
writeFileSync(entry, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') console.log('codex 0.154.0');
else if (args[0] === 'login') console.log('Logged in using ChatGPT');
else if (args[0] === 'auth') console.log(JSON.stringify({ loggedIn: true }));
else if (args[0] === 'wait') process.stdin.resume();
else console.log(JSON.stringify(args));
`);
const cmd = join(binDir, "codex.cmd");
// Match npm/cmd-shim's dispatch instead of a hand-written batch wrapper.
writeFileSync(cmd, [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b',
  ':start', 'SETLOCAL', 'CALL :find_dp0',
  `SET "_prog=${process.execPath}"`,
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\probe.cjs" %*',
  '',
].join('\r\n'));
afterAll(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

describe("engine process launch", () => {
  it("preserves argument boundaries through the shared launcher", async () => {
    const args = ['two words', 'a"b', '(paren)', 'x&y', '%PATH%', 'semi;colon'];
    const child = spawnEngine(process.execPath, [entry, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual(args);
  });

  it("forwards the Claude SDK abort signal to a piped child", async () => {
    const ctl = new AbortController();
    const child = spawnClaudeProcess({ command: process.execPath, args: [entry, 'wait'], env: process.env, signal: ctl.signal });
    const error = new Promise<Error>((resolve) => child.once("error", resolve));
    const closed = new Promise((resolve) => child.once("close", resolve));
    await new Promise((resolve) => child.once("spawn", resolve));
    ctl.abort();
    expect((await error).name).toBe("AbortError");
    await closed;
  });
});

describe.skipIf(process.platform !== "win32")("Windows npm launcher", () => {
  it("rejects unknown batch wrappers instead of forwarding arguments through a shell", () => {
    for (const ext of ['cmd', 'bat']) {
      const wrapper = join(binDir, `unknown.${ext}`);
      writeFileSync(wrapper, '@echo off\r\necho %*\r\n');
      expect(() => spawnEngine(wrapper, ['a"b&c'], { stdio: 'pipe' })).toThrow(/doesn't appear to be a cmd-shim/);
    }
  });

  it("runs a cmd shim in a spaced path with quoted and shell-special arguments", async () => {
    const args = ['two words', 'a"b', '(paren)', 'x&y', '%PATH%', 'semi;colon'];
    const child = spawnEngine(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    expect(code, stderr).toBe(0);
    expect(JSON.parse(output)).toEqual(args);
  });

  it("detects and authenticates engines launched through cmd files", async () => {
    vi.stubEnv("AGENTNET_CODEX_PATH", cmd);
    vi.stubEnv("AGENTNET_CLAUDE_PATH", cmd);
    const { detectCli } = await import("./detect.js");
    expect(await detectCli()).toEqual({ claude: "ok", codex: "ok" });
  });

  it("launches the Claude SDK process through the same cmd adapter", async () => {
    const child = spawnClaudeProcess({ command: cmd, args: ['SDK round trip'], env: process.env, signal: new AbortController().signal });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual(['SDK round trip']);
  });

  it("prefers the Windows shim when where also finds an extensionless launcher", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PATH", `${binDir};${process.env.PATH}`);
    vi.stubEnv("AGENTNET_CODEX_PATH", "");
    writeFileSync(join(binDir, "codex"), "#!/bin/sh\nexit 1\n");
    vi.resetModules();
    const { resolveEngineBin } = await import("./engineBin.js");
    expect(realpathSync.native(resolveEngineBin("codex"))).toBe(realpathSync.native(cmd));
  });
});
