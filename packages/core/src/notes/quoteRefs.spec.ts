import { describe, it, expect } from "vitest";
import { extractQuoteRefs, parseNoteRef, QUOTE_REFS_MAX } from "./quoteRefs.js";

const W = "C3EPAsjHq6DHLDzG2bXySFpUYmQ5AUqDXDfEiEsCekrH";
const id = (n: string) => `note:${W}:1787813695000:${n}`;

describe("notes/quoteRefs — the >>note: text convention", () => {
  it("extracts a ref with its author, from anywhere in the text", () => {
    const refs = extractQuoteRefs(`saw this earlier\n>>${id("9n4iry")}\nand it holds up`);
    expect(refs).toEqual([{ ref: id("9n4iry"), author: W }]);
  });

  it("dedupes repeats and keeps first-appearance order", () => {
    const refs = extractQuoteRefs(`>>${id("aaaaaa")} then >>${id("bbbbbb")} then >>${id("aaaaaa")}`);
    expect(refs.map((r) => r.ref)).toEqual([id("aaaaaa"), id("bbbbbb")]);
  });

  it("caps at QUOTE_REFS_MAX so one note cannot fan out unbounded reads", () => {
    const many = Array.from({ length: QUOTE_REFS_MAX + 3 }, (_, i) => `>>${id(`n${i}pad0`)}`).join(" ");
    expect(extractQuoteRefs(many)).toHaveLength(QUOTE_REFS_MAX);
  });

  it("ignores things that only look like refs", () => {
    for (const bad of [
      ">>note:short:1787813695000:9n4iry", // wallet too short
      ">>note:" + W + ":17878:9n4iry", // timestamp too short
      ">>tx:" + W, // wrong scheme
      "note:" + W + ":1787813695000:9n4iry", // no >> marker
      ">>note:" + W + ":1787813695000:9N4IRY", // uppercase nonce: toString(36) never mints one
      undefined,
      "",
    ]) {
      expect(extractQuoteRefs(bad as string | undefined)).toEqual([]);
    }
  });

  it("a ref glued to alphanumeric text is no match, never a corrupted id", () => {
    // punctuation after the nonce is fine; letters or digits are ambiguous
    expect(extractQuoteRefs(`see >>${id("9n4iry")}.`)).toEqual([{ ref: id("9n4iry"), author: W }]);
    expect(extractQuoteRefs(`(>>${id("9n4iry")})`)).toEqual([{ ref: id("9n4iry"), author: W }]);
    expect(extractQuoteRefs(`>>${id("9n4iry")}\nnext line`)).toEqual([{ ref: id("9n4iry"), author: W }]);
    expect(extractQuoteRefs(`>>${id("9n4iry")}glued`)).toEqual([]);
    expect(extractQuoteRefs(`>>${id("9n4iry")}9`)).toEqual([]);
    expect(extractQuoteRefs(`>>${id("9n4iry")}X`)).toEqual([]);
  });

  it("accepts the real nonce range: 4 to 6 lowercase base36 chars", () => {
    expect(extractQuoteRefs(`>>${id("ab12")}`)).toHaveLength(1);
    expect(extractQuoteRefs(`>>${id("ab12cd")}`)).toHaveLength(1);
    expect(extractQuoteRefs(`>>${id("ab12cd3")}`)).toEqual([]); // 7: longer than slice(2, 8) can mint
    expect(extractQuoteRefs(`>>${id("ab1")}`)).toEqual([]); // too short
  });

  it("parseNoteRef accepts exactly one bare id and rejects surrounding junk", () => {
    expect(parseNoteRef(id("9n4iry"))).toEqual({ ref: id("9n4iry"), author: W });
    expect(parseNoteRef(id("9n4iry") + "!!")).toBeNull();
    expect(parseNoteRef("x" + id("9n4iry"))).toBeNull();
    expect(parseNoteRef("nope")).toBeNull();
    expect(parseNoteRef(undefined)).toBeNull();
  });
});
