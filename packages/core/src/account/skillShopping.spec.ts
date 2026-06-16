import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSkillShopping, setSkillShopping } from "./login.js";

// The toggle lives in config.json under AGENTNET_HOME (issue #21). Point it at a temp
// dir so each test owns a clean store.
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentnet-test-"));
  process.env.AGENTNET_HOME = home;
});

afterEach(() => {
  delete process.env.AGENTNET_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("skill-shopping toggle persistence", () => {
  it("defaults ON when no config exists", async () => {
    expect(await getSkillShopping()).toBe(true);
  });

  it("persists OFF then back ON", async () => {
    await setSkillShopping(false);
    expect(await getSkillShopping()).toBe(false);
    await setSkillShopping(true);
    expect(await getSkillShopping()).toBe(true);
  });

  it("preserves other config fields (storage choice) across a toggle write", async () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ kind: "gdrive", google_client_id: "id" }, null, 2),
    );
    await setSkillShopping(false);
    const cfg = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(cfg.kind).toBe("gdrive");
    expect(cfg.google_client_id).toBe("id");
    expect(cfg.skillShopping).toBe(false);
  });
});
