import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// Every case models a GUI-launched host: the bare launchd PATH and a HOME that holds the
// engine but, unless the case says so, no node. The resolver rightly scans install homes
// outside HOME too (/opt/homebrew/bin, /usr/local/bin), and this box and most CI runners
// keep a real node there, so existsSync is confined to the faked HOME for this file only.
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (p: Parameters<typeof real.existsSync>[0]) =>
      String(p).startsWith(`${process.env.HOME}/`) && real.existsSync(p),
  };
});

// /usr/bin and /bin stay for sh, env and which. The existsSync mock keeps fromPath from accepting a
// /usr/bin/node, but the spawned shim does not go through the mock: a box with /usr/bin/node (Debian
// apt nodejs) would run it and report the no-node cases as ok. ubuntu-latest and macOS keep node
// elsewhere.
const BARE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

// The shim from #226 items 7 and 8: what bun, standalone pnpm and the legacy migrate-installer
// launcher put in their bin dir, with no node beside it.
const NODE_SHIM = "#!/usr/bin/env node\n";

// `env node <shim> <args>`: the shim path arrives as $1, so the engine's args start at $2.
const FAKE_NODE = `#!/bin/sh
case "$2" in
  --version) echo 9.9.9 ;;
  auth) echo '{"loggedIn":true}' ;;
  login) echo "Logged in using ChatGPT" ;;
esac
exit 0
`;

// Stand-in for the native installer's self-contained binary (item 8).
const NATIVE_CLAUDE = `#!/bin/sh
case "$1" in
  --version) echo 2.1.265 ;;
  auth) echo '{"loggedIn":true}' ;;
esac
exit 0
`;

// Starts fine (--version exits 0) but is signed out: both auth probes exit 1.
const LOGGED_OUT = `#!/bin/sh
case "$1" in
  --version) echo 1.0.0; exit 0 ;;
  auth) echo '{"loggedIn":false}'; exit 1 ;;
  login) echo "Not logged in"; exit 1 ;;
esac
exit 1
`;

function exe(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

describe("detectCli against launchers that cannot start", () => {
  let home: string;
  const nvmBin = () => join(home, ".nvm", "versions", "node", "v22.0.0", "bin");
  // ensureNode falls back to the runtime running the check, and under vitest that is a real
  // node; point it at nothing so the no-node cases stay no-node.
  const realExecPath = process.execPath;

  // vi.stubEnv writes the real process.env, which os.homedir() and every child spawn read;
  // reassigning process.env to a copy would leave both looking at the real home.
  beforeEach(() => {
    // engineBin.ts caches resolved paths and mutates PATH for the process; start each case clean.
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "detect-"));
    vi.stubEnv("HOME", home); // candidates() reads os.homedir(), which AGENTNET_HOME does not cover
    vi.stubEnv("AGENTNET_HOME", join(home, ".agentnet")); // isolates the codex-key token file
    vi.stubEnv("PATH", BARE_PATH);
    vi.stubEnv("AGENTNET_CLAUDE_PATH", undefined);
    vi.stubEnv("AGENTNET_CODEX_PATH", undefined);
    process.execPath = join(home, "not-node");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.execPath = realExecPath;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("node shims with no node anywhere are missing, not no-login", async () => {
    exe(join(home, ".bun", "bin", "claude"), NODE_SHIM);
    exe(join(home, ".bun", "bin", "codex"), NODE_SHIM);
    const { detectCli } = await import("./detect.js");
    const { resolveEngineBin } = await import("./engineBin.js");

    expect(await detectCli()).toEqual({ claude: "missing", codex: "missing" });
    // The resolver still says where the engine is; whether it runs is detect's answer.
    expect(resolveEngineBin("claude")).toBe(join(home, ".bun", "bin", "claude"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("no node on PATH"));
  });

  it.skipIf(process.platform === "win32")("a version-manager node is put on PATH so the shim runs", async () => {
    exe(join(home, ".bun", "bin", "claude"), NODE_SHIM);
    exe(join(home, ".bun", "bin", "codex"), NODE_SHIM);
    exe(join(nvmBin(), "node"), FAKE_NODE);
    const { detectCli } = await import("./detect.js");

    expect(await detectCli()).toEqual({ claude: "ok", codex: "ok" });
    expect(process.env.PATH!.split(delimiter)).toContain(nvmBin());
  });

  it.skipIf(process.platform === "win32")("the node running the check is the last resort, as under the desktop app's bundled node", async () => {
    exe(join(home, ".bun", "bin", "claude"), NODE_SHIM);
    exe(join(home, ".bun", "bin", "codex"), NODE_SHIM);
    exe(join(home, "nodebin", "node"), FAKE_NODE);
    process.execPath = join(home, "nodebin", "node");
    const { detectCli } = await import("./detect.js");

    expect(await detectCli()).toEqual({ claude: "ok", codex: "ok" });
    expect(process.env.PATH!.split(delimiter)).toContain(join(home, "nodebin"));
  });

  it.skipIf(process.platform === "win32")("node installed after a missing report is picked up without a reload", async () => {
    exe(join(home, ".bun", "bin", "claude"), NODE_SHIM);
    exe(join(home, ".bun", "bin", "codex"), NODE_SHIM);
    const { detectCli } = await import("./detect.js");
    expect(await detectCli()).toEqual({ claude: "missing", codex: "missing" });

    exe(join(nvmBin(), "node"), FAKE_NODE);
    expect(await detectCli()).toEqual({ claude: "ok", codex: "ok" });
  });

  it.skipIf(process.platform === "win32")("the native install outranks the legacy migrate-installer launcher", async () => {
    exe(join(home, ".claude", "local", "claude"), NODE_SHIM);
    exe(join(home, ".local", "bin", "claude"), NATIVE_CLAUDE);
    const { detectCli } = await import("./detect.js");
    const { resolveEngineBin } = await import("./engineBin.js");

    expect(resolveEngineBin("claude")).toBe(join(home, ".local", "bin", "claude"));
    expect((await detectCli()).claude).toBe("ok");
  });

  it.skipIf(process.platform === "win32")("the legacy launcher is still found when it is the only install", async () => {
    exe(join(home, ".claude", "local", "claude"), NODE_SHIM);
    exe(join(nvmBin(), "node"), FAKE_NODE);
    const { detectCli } = await import("./detect.js");
    const { resolveEngineBin } = await import("./engineBin.js");

    expect(resolveEngineBin("claude")).toBe(join(home, ".claude", "local", "claude"));
    expect((await detectCli()).claude).toBe("ok");
  });

  it.skipIf(process.platform === "win32")("guard, passes on main too: an engine that starts but is signed out stays no-login, the exit-code rule is for --version only", async () => {
    exe(join(home, ".local", "bin", "claude"), LOGGED_OUT);
    exe(join(home, ".local", "bin", "codex"), LOGGED_OUT);
    const { detectCli } = await import("./detect.js");

    expect(await detectCli()).toEqual({ claude: "no-login", codex: "no-login" });
  });

  it.skipIf(process.platform === "win32")("a saved codex API key no longer masks a launcher that cannot start", async () => {
    exe(join(home, ".bun", "bin", "codex"), NODE_SHIM);
    const { saveCodexApiKey } = await import("../account/codexAuth.js");
    await saveCodexApiKey("sk-test");
    const { detectCli } = await import("./detect.js");

    expect((await detectCli()).codex).toBe("missing");
  });
});
