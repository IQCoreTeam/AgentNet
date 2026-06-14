import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSkillShoppingActive, PASSIVE_SKILL_SLUG } from "./passive.js";
import { claudeSkillsDir, codexSkillsDir, inactiveSkillsDir } from "../core/paths.js";

// setSkillShoppingActive moves the bundled skill between each runtime's scanned skills dir
// and a holding dir (plan §6). We point AGENTNET_HOME at a temp dir and assert the file
// is present in / absent from the scanned dirs as the toggle flips — for BOTH engines.
const exists = (p: string) => access(p).then(() => true).catch(() => false);
const skillMd = (base: string) => join(base, PASSIVE_SKILL_SLUG, "SKILL.md");

describe("skill-shopping toggle = file move (plan §6)", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevClaude: string | undefined;
  let prevCodex: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "agentnet-skillshop-"));
    // route every path (root + both engine homes) under the temp dir
    prevHome = process.env.AGENTNET_HOME;
    prevClaude = process.env.CLAUDE_CONFIG_DIR;
    prevCodex = process.env.CODEX_HOME;
    process.env.AGENTNET_HOME = home;
    process.env.CLAUDE_CONFIG_DIR = join(home, "claude");
    process.env.CODEX_HOME = join(home, "codex");
  });

  afterEach(async () => {
    process.env.AGENTNET_HOME = prevHome;
    process.env.CLAUDE_CONFIG_DIR = prevClaude;
    process.env.CODEX_HOME = prevCodex;
    await rm(home, { recursive: true, force: true });
  });

  it("ON writes the SKILL.md into both scanned skills dirs", async () => {
    await setSkillShoppingActive(true);
    expect(await exists(skillMd(claudeSkillsDir()))).toBe(true);
    expect(await exists(skillMd(codexSkillsDir()))).toBe(true);
    const body = await readFile(skillMd(claudeSkillsDir()), "utf8");
    expect(body).toContain(`name: ${PASSIVE_SKILL_SLUG}`);
    expect(body).toContain("description:"); // trigger lives in the frontmatter
  });

  it("OFF moves it out of the scanned dirs into the holding dir (not deleted)", async () => {
    await setSkillShoppingActive(true);
    await setSkillShoppingActive(false);
    // gone from where the CLI scans …
    expect(await exists(skillMd(claudeSkillsDir()))).toBe(false);
    expect(await exists(skillMd(codexSkillsDir()))).toBe(false);
    // … but preserved in the holding dir
    expect(await exists(skillMd(inactiveSkillsDir("claude")))).toBe(true);
    expect(await exists(skillMd(inactiveSkillsDir("codex")))).toBe(true);
  });

  it("re-toggling ON brings it back to the scanned dirs", async () => {
    await setSkillShoppingActive(true);
    await setSkillShoppingActive(false);
    await setSkillShoppingActive(true);
    expect(await exists(skillMd(claudeSkillsDir()))).toBe(true);
    expect(await exists(skillMd(codexSkillsDir()))).toBe(true);
  });

  it("toggling OFF twice is idempotent (no throw, stays inactive)", async () => {
    await setSkillShoppingActive(true);
    await setSkillShoppingActive(false);
    await setSkillShoppingActive(false); // must not throw
    expect(await exists(skillMd(claudeSkillsDir()))).toBe(false);
    expect(await exists(skillMd(inactiveSkillsDir("claude")))).toBe(true);
  });
});