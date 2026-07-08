import { describe, it, expect } from "vitest";
import { parseSoul } from "./parse.js";
import { soulToElizaPersona } from "./convert/eliza.js";

const SOUL = `# Name
Luna

## Bio
- Solana-native designer agent
Works across machines

## Style
- terse
- no emoji

## Lore
- born on devnet

## Boundaries
- never spend without verify

## Custom Rituals
Every dawn, recompile.
`;

describe("soul/parse", () => {
  it("lifts recognized sections and preserves the rest as extras", () => {
    const p = parseSoul(SOUL);
    expect(p.name).toBe("Luna");
    expect(p.bio).toEqual(["Solana-native designer agent", "Works across machines"]);
    expect(p.style).toEqual(["terse", "no emoji"]);
    expect(p.lore).toEqual(["born on devnet"]);
    expect(p.boundaries).toEqual(["never spend without verify"]);
    expect(p.extras).toEqual([{ heading: "Custom Rituals", body: "Every dawn, recompile." }]);
  });

  it("treats a bare H1 as the name and keeps preamble text", () => {
    const p = parseSoul("free-floating intro\n\n# Luna\n\n## Bio\n- x");
    expect(p.name).toBe("Luna");
    expect(p.extras[0]).toEqual({ heading: "", body: "free-floating intro" });
    expect(p.bio).toEqual(["x"]);
  });

  it("parses an empty/heading-less soul without throwing", () => {
    const p = parseSoul("just prose, no headings");
    expect(p.name).toBeUndefined();
    expect(p.extras[0].body).toBe("just prose, no headings");
  });
});

describe("soul/convert/eliza", () => {
  it("maps sections to characterfile fields; extras concatenate into lore", () => {
    const c = soulToElizaPersona(SOUL);
    expect(c.name).toBe("Luna");
    expect(c.bio).toEqual(["Solana-native designer agent", "Works across machines"]);
    expect(c.style.all).toEqual(["terse", "no emoji"]);
    expect(c.lore).toContain("born on devnet");
    expect(c.lore.join("\n")).toContain("Custom Rituals");
    expect(c.system).toBe("never spend without verify");
  });

  it("falls back to the provided name and omits system when no boundaries", () => {
    const c = soulToElizaPersona("## Bio\n- minimal", "fallback-name");
    expect(c.name).toBe("fallback-name");
    expect(c.system).toBeUndefined();
  });
});
