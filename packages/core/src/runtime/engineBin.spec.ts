import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEngineBin } from "./engineBin.js";

// resolveEngineBin caches a resolved path for the whole process. This locks in that the
// cache SELF-HEALS when that path disappears or is replaced — an interrupted `npm install
// -g` (which leaves a half-linked package) or a version-manager upgrade removing the old
// bin symlink. Before the fix, a stale hit meant every spawn shelled a now-dangling
// absolute path and died with a bare ENOENT until the app was reloaded, even after the
// user reinstalled the engine. vitest isolates modules per file, so this file owns the
// module-level cache and the first resolve below primes it cleanly.
describe("resolveEngineBin cache self-heal", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.AGENTNET_CODEX_PATH;
  });

  it("re-resolves after the cached binary is deleted and replaced", () => {
    const dir = mkdtempSync(join(tmpdir(), "enginebin-"));
    dirs.push(dir);
    const first = join(dir, "codex-a");
    const second = join(dir, "codex-b");
    for (const f of [first, second]) {
      writeFileSync(f, "#!/bin/sh\n");
      chmodSync(f, 0o755);
    }

    // The override escape hatch is checked against existsSync, so it exercises the same
    // resolve/cache path a real install would.
    process.env.AGENTNET_CODEX_PATH = first;
    expect(resolveEngineBin("codex")).toBe(first); // resolves + caches

    // The upgrade removes the old bin and lands a new one.
    rmSync(first, { force: true });
    process.env.AGENTNET_CODEX_PATH = second;
    expect(resolveEngineBin("codex")).toBe(second); // stale cache dropped, not the dead path
  });
});
