import { describe, it, expect } from "vitest";
import { toSkillMd } from "./convert.js";
import type { SkillMintMetadata } from "../../nft/token2022.js";

const meta = (over: Partial<SkillMintMetadata>): SkillMintMetadata => ({
  name: "pptx",
  symbol: "SKILL",
  uri: "tx",
  ...over,
});

describe("toSkillMd frontmatter normalization", () => {
  it("quotes a publisher description containing ': ' (the codex strict-YAML fix)", () => {
    // Anthropic's pptx/docx ship exactly this shape: unquoted description with ": "
    // inside. Claude tolerates it; codex's parser read the inner ": " as a nested
    // mapping and dropped the whole skill.
    const body =
      "---\nname: pptx\ndescription: Use this skill. This includes: creating decks, or both.\ncategory: documents\n---\n\n# Body";
    const out = toSkillMd(meta({ skillText: body }), "mint1");
    // value is now ONE quoted scalar — the inner ": " can't be misread as a mapping
    expect(out).toContain(
      'description: "Use this skill. This includes: creating decks, or both."',
    );
    // the loose unquoted form is gone
    expect(out).not.toMatch(/^description: Use this skill\./m);
  });

  it("leaves an already-quoted description untouched (idempotent)", () => {
    const body = '---\nname: x\ndescription: "Already: quoted"\n---\n\nbody';
    const out = toSkillMd(meta({ skillText: body }), "m");
    expect(out).toContain('description: "Already: quoted"');
    expect(out).not.toContain('\\"Already'); // not re-escaped / double-quoted
  });

  it("leaves flow collections and block scalars untouched", () => {
    const body =
      "---\nname: x\nhashtags: [docs, pptx]\nlong: |\n  line one: with colon\n  line two\n---\n\nbody";
    const out = toSkillMd(meta({ skillText: body }), "m");
    expect(out).toContain("hashtags: [docs, pptx]"); // flow list intact
    expect(out).toContain("long: |"); // block indicator intact
    expect(out).toContain("  line one: with colon"); // block content intact (not quoted)
  });

  it("still synthesizes safe frontmatter when the body has none", () => {
    const out = toSkillMd(
      meta({ name: "n", description: "a: b", skillText: "just body" }),
      "m",
    );
    expect(out).toContain('description: "a: b"');
    expect(out).toContain("just body");
  });
});
