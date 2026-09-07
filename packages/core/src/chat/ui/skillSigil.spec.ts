// Pins skillSigilSvg to the goldens captured from the string-shipped SKILL_SIGIL_SCRIPT right
// before the #215 module port, so the real export cannot drift from what the panel rendered.
import { describe, it, expect } from "vitest";
import { skillSigilSvg } from "./skillSigil.js";
import goldens from "../../../test/fixtures/panel/sigilGoldens.json";

describe("chat/ui/skillSigil: skillSigilSvg matches the pre-migration goldens", () => {
  it("reproduces every golden byte-for-byte", () => {
    expect(goldens).toHaveLength(5);
    for (const g of goldens) expect(skillSigilSvg(g.name)).toBe(g.svg);
  });

  it("is deterministic: the same name twice is identical", () => {
    for (const g of goldens) expect(skillSigilSvg(g.name)).toBe(skillSigilSvg(g.name));
  });
});
