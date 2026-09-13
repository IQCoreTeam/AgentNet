import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { resolveEngineBin } from "./engineBin.js";
import { getEngineVersions, updateEngine } from "./engineVersions.js";

// Every process spawned is a #!/bin/sh script in a temp dir, so nothing here depends on a
// real engine, a real npm or the network (fetch is stubbed). vitest isolates modules per
// file, so this file owns the resolver's module-level cache; each case's binary is removed
// in afterEach, which makes the cache self-heal into a fresh resolve for the next case.

// Stands in for npm on PATH: logs every call, does nothing else.
const FAKE_NPM = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
exit 0
`;

// Stands in for an installed codex. Logs its argv; `update` swaps the version behind the
// same path, as the real updaters do. When the case gives it something to say, it says it
// (stdout, or stderr on request), exits as told and changes nothing.
const CODEX = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_CODEX_LOG"
case "$1" in
  --version) if [ -f "$FAKE_CODEX_LOG.updated" ]; then echo codex-cli 0.2.0; else echo codex-cli 0.1.0; fi ;;
  update)
    if [ -n "$FAKE_CODEX_SAYS" ]; then
      if [ "$FAKE_CODEX_TO" = stderr ]; then echo "$FAKE_CODEX_SAYS" >&2; else echo "$FAKE_CODEX_SAYS"; fi
      exit "\${FAKE_CODEX_EXIT:-0}"
    fi
    touch "$FAKE_CODEX_LOG.updated" ;;
esac
exit 0
`;

function exe(path: string, body: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

function lines(log: string): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

describe("updateEngine sees its own result", () => {
  const dirs: string[] = [];
  const env = { ...process.env };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  // A temp home: the fake npm first on PATH, a fake claude pinned through the override so
  // getEngineVersions never spawns a real one, the codex under test pinned the same way.
  // /usr/bin and /bin stay for sh, printf and touch.
  function codex(): string {
    const dir = mkdtempSync(join(tmpdir(), "engineversions-"));
    dirs.push(dir);
    exe(join(dir, "fake", "npm"), FAKE_NPM);
    process.env.AGENTNET_CLAUDE_PATH = exe(join(dir, "fake", "claude"), "#!/bin/sh\necho 2.0.0\n");
    process.env.AGENTNET_CODEX_PATH = exe(join(dir, "bin", "codex"), CODEX);
    process.env.FAKE_NPM_LOG = join(dir, "npm.log");
    process.env.FAKE_CODEX_LOG = join(dir, "codex.log");
    process.env.PATH = [join(dir, "fake"), "/usr/bin", "/bin"].join(delimiter);
    vi.stubGlobal("fetch", async () => ({ ok: false }));
    return process.env.AGENTNET_CODEX_PATH;
  }

  it("runs the engine's own updater, never npm, and reports the new version at the same path", async () => {
    const bin = codex();
    expect(resolveEngineBin("codex")).toBe(bin);

    await updateEngine("codex");

    expect(lines(process.env.FAKE_CODEX_LOG!)).toEqual(["--version", "update", "--version"]);
    expect(lines(process.env.FAKE_NPM_LOG!)).toEqual([]);
    expect(resolveEngineBin("codex")).toBe(bin);
    expect((await getEngineVersions()).codex.installed).toBe("0.2.0");
  });

  it("surfaces the updater's stderr reason when it fails", async () => {
    codex();
    process.env.FAKE_CODEX_SAYS = "error: no write access to /opt/codex/releases";
    process.env.FAKE_CODEX_TO = "stderr";
    process.env.FAKE_CODEX_EXIT = "1";

    await expect(updateEngine("codex")).rejects.toThrow("no write access to /opt/codex/releases");
    expect(lines(process.env.FAKE_NPM_LOG!)).toEqual([]);
  });

  it("surfaces a stdout reason when the updater fails with an empty stderr", async () => {
    codex();
    process.env.FAKE_CODEX_SAYS = "Update failed: could not reach the release server";
    process.env.FAKE_CODEX_EXIT = "1";

    await expect(updateEngine("codex")).rejects.toThrow("could not reach the release server");
    expect(lines(process.env.FAKE_NPM_LOG!)).toEqual([]);
  });

  it("treats an updater that exits 0 without changing the version as a failure", async () => {
    // claude under Homebrew: the brew command on stdout, exit 0, nothing changed.
    codex();
    process.env.FAKE_CODEX_SAYS = "Codex is managed by Homebrew. To update, run: brew upgrade codex";

    await expect(updateEngine("codex")).rejects.toThrow("To update, run: brew upgrade codex");
    expect(lines(process.env.FAKE_NPM_LOG!)).toEqual([]);
    expect((await getEngineVersions()).codex.installed).toBe("0.1.0");
  });

  it("accepts an unchanged version when the updater says it is already up to date", async () => {
    // A stale registry read showed the button; the engine's channel has nothing newer.
    codex();
    process.env.FAKE_CODEX_SAYS = "codex-cli 0.1.0 is already up to date";

    await updateEngine("codex");

    expect(lines(process.env.FAKE_NPM_LOG!)).toEqual([]);
    expect((await getEngineVersions()).codex.installed).toBe("0.1.0");
  });
});
