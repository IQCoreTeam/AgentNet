// The claude image content-block shape is the part most likely to be SILENTLY wrong
// (a bad shape → the model just ignores the image, no error). Pin it down.
import { describe, it, expect } from "vitest";
import { claudeUserContent } from "./spawn.js";

const png = { mime: "image/png", dataBase64: "AAAA", name: "a.png" };
const jpg = { mime: "image/jpeg", dataBase64: "BBBB" };

describe("runtime/spawn — claudeUserContent (Anthropic content blocks)", () => {
  it("returns a plain string when there are no images (unchanged common path)", () => {
    expect(claudeUserContent("hello", undefined)).toBe("hello");
    expect(claudeUserContent("hello", [])).toBe("hello");
  });

  it("builds a text block + one base64 image block per image", () => {
    const c = claudeUserContent("look at this", [png, jpg]) as any[];
    expect(Array.isArray(c)).toBe(true);
    expect(c[0]).toEqual({ type: "text", text: "look at this" });
    expect(c[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
    expect(c[2]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" } });
  });

  it("drops the empty text block for an image-only turn", () => {
    const c = claudeUserContent("", [png]) as any[];
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe("image");
  });
});
