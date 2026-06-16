import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_SKILLS,
  MAKE_SKILL_SLUG,
  classifySkills,
  skillOrigin,
  readSkillManifest,
  recordNftSkill,
  forgetNftSkill,
} from "./registry.js";
import { PASSIVE_SKILL_SLUG } from "./passive.js";
import { skillsManifestFile } from "../core/paths.js";

// The registry records NFT-bought slugs in ~/.agentnet/skills.json so a surface can tell
// bundled / nft / local apart even though the SKILL.md files are identical. Point
// AGENTNET_HOME at a temp dir and assert the manifest + classification behave.
describe("skill-origin registry", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "agentnet-registry-"));
    prevHome = process.env.AGENTNET_HOME;
    process.env.AGENTNET_HOME = home;
  });

  afterEach(async () => {
    process.env.AGENTNET_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("the bundled set is skill-shopping + make-skill", () => {
    expect(BUNDLED_SKILLS).toContain(PASSIVE_SKILL_SLUG);
    expect(BUNDLED_SKILLS).toContain(MAKE_SKILL_SLUG);
  });

  it("a missing manifest reads as empty (best-effort, no throw)", async () => {
    const m = await readSkillManifest();
    expect(m).toEqual({ version: 1, nft: {} });
  });

  it("records an NFT skill with its mint, then forgets it (round-trip)", async () => {
    await recordNftSkill("clean-code-refactor", "MINT111");
    let m = await readSkillManifest();
    expect(m.nft["clean-code-refactor"].mint).toBe("MINT111");
    // persisted to disk as the documented shape
    const onDisk = JSON.parse(await readFile(skillsManifestFile(), "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.nft["clean-code-refactor"].mint).toBe("MINT111");

    await forgetNftSkill("clean-code-refactor");
    m = await readSkillManifest();
    expect(m.nft["clean-code-refactor"]).toBeUndefined();
  });

  it("classifies bundled, nft, and local correctly", async () => {
    await recordNftSkill("bought-skill", "MINT222");
    const m = await readSkillManifest();
    expect(skillOrigin(PASSIVE_SKILL_SLUG, m)).toBe("bundled");
    expect(skillOrigin(MAKE_SKILL_SLUG, m)).toBe("bundled");
    expect(skillOrigin("bought-skill", m)).toBe("nft");
    expect(skillOrigin("my-own-skill", m)).toBe("local");
  });

  it("bundled wins over a stale manifest entry (a bundled slug never reads as nft)", async () => {
    // even if make-skill somehow got recorded, classification must keep it bundled
    await recordNftSkill(MAKE_SKILL_SLUG, "MINT333");
    const m = await readSkillManifest();
    expect(skillOrigin(MAKE_SKILL_SLUG, m)).toBe("bundled");
  });

  it("classifySkills tags a list and attaches the mint for nft only", async () => {
    await recordNftSkill("bought-skill", "MINT444");
    const tagged = await classifySkills([PASSIVE_SKILL_SLUG, "bought-skill", "my-own-skill"]);
    expect(tagged).toEqual([
      { slug: PASSIVE_SKILL_SLUG, origin: "bundled" },
      { slug: "bought-skill", origin: "nft", mint: "MINT444" },
      { slug: "my-own-skill", origin: "local" },
    ]);
  });
});
