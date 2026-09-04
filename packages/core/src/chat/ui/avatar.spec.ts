// Pins hashSeed/avatarSvg to the goldens captured from the string-shipped AVATAR_SCRIPT right
// before the #215 module port, so the real exports cannot drift from what the panel rendered.
import { describe, it, expect } from "vitest";
import { hashSeed, avatarSvg } from "./avatar.js";
import goldens from "../../../test/fixtures/panel/avatarGoldens.json";

describe("chat/ui/avatar: hashSeed and avatarSvg match the pre-migration goldens", () => {
  it("reproduces every golden byte-for-byte", () => {
    expect(goldens).toHaveLength(5);
    for (const g of goldens) {
      expect(hashSeed(g.seed)).toBe(g.hash);
      expect(avatarSvg(g.seed)).toBe(g.svg);
    }
  });

  it("drops the shared <style> block so two avatars on one page cannot recolor each other", () => {
    for (const g of goldens) expect(avatarSvg(g.seed)).not.toContain("<style>");
  });

  it("gives different seeds different faces; the empty seed is the 'default' face", () => {
    const named = goldens.filter((g) => g.seed !== "");
    expect(new Set(named.map((g) => avatarSvg(g.seed))).size).toBe(named.length);
    expect(avatarSvg("")).toBe(avatarSvg("default"));
  });
});
