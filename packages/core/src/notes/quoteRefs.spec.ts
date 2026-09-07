import { describe, it, expect } from "vitest";
import { extractQuoteRefs, parseNoteRef, splitQuoteRefs, QUOTE_REFS_MAX } from "./quoteRefs.js";

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

describe("notes/quoteRefs: splitQuoteRefs, the panel's inline-render input", () => {
  it("alternates text and ref segments in order and skips empty text runs", () => {
    expect(splitQuoteRefs(`see >>${id("aaaaaa")} and >>${id("bbbbbb")}!`)).toEqual([
      { text: "see " },
      { ref: id("aaaaaa"), author: W },
      { text: " and " },
      { ref: id("bbbbbb"), author: W },
      { text: "!" },
    ]);
    expect(splitQuoteRefs(`>>${id("aaaaaa")}`)).toEqual([{ ref: id("aaaaaa"), author: W }]);
    expect(splitQuoteRefs(`>>${id("aaaaaa")}>>${id("bbbbbb")}`)).toEqual([
      { ref: id("aaaaaa"), author: W },
      { ref: id("bbbbbb"), author: W },
    ]);
    expect(splitQuoteRefs("")).toEqual([]);
    expect(splitQuoteRefs("plain text")).toEqual([{ text: "plain text" }]);
  });

  it("keeps duplicates and never caps: the per-view accounting belongs to the renderer", () => {
    const many = Array.from({ length: QUOTE_REFS_MAX + 3 }, () => `>>${id("aaaaaa")}`).join(" ");
    expect(splitQuoteRefs(many).filter((s) => "ref" in s)).toHaveLength(QUOTE_REFS_MAX + 3);
  });

  it("refuses a ref glued to alphanumerics and accepts 4-6 char nonces", () => {
    expect(splitQuoteRefs(`>>${id("9n4iry")}glued`)).toEqual([{ text: `>>${id("9n4iry")}glued` }]);
    expect(splitQuoteRefs(`>>${id("9n4iry")}9`)).toEqual([{ text: `>>${id("9n4iry")}9` }]);
    expect(splitQuoteRefs(`>>${id("ab12")}`)).toEqual([{ ref: id("ab12"), author: W }]);
    expect(splitQuoteRefs(`>>${id("ab12cd")}`)).toEqual([{ ref: id("ab12cd"), author: W }]);
    expect(splitQuoteRefs(`>>${id("ab12cd3")}`)).toEqual([{ text: `>>${id("ab12cd3")}` }]);
    expect(splitQuoteRefs(`>>${id("ab1")}`)).toEqual([{ text: `>>${id("ab1")}` }]);
  });

  it("splits exactly like the retired panel regex did", () => {
    // webview.ts W:4115 before #215, kept here only as the equivalence oracle: split() with the
    // capture group put refs at odd indexes and (possibly empty) text runs at even ones.
    const LEGACY_PANEL_SPLIT_RE = /(>>note:[1-9A-HJ-NP-Za-km-z]{32,44}:[0-9]{10,16}:[a-z0-9]{4,6})(?![A-Za-z0-9])/;
    const texts = [
      "",
      "no refs here",
      `>>${id("aaaaaa")}`,
      `lead >>${id("aaaaaa")}`,
      `>>${id("aaaaaa")} trail`,
      `a >>${id("aaaaaa")} b >>${id("bbbbbb")} c`,
      `>>${id("aaaaaa")}>>${id("bbbbbb")}`,
      `>>${id("aaaaaa")} twice >>${id("aaaaaa")}`,
      `glued >>${id("aaaaaa")}x and ok >>${id("bbbbbb")}.`,
      `line one\n>>${id("ab12")}\nline three`,
      `한글 앞 >>${id("cd34ef")} 한글 뒤`,
      `>>tx:${W} and (>>${id("aaaaaa")}) and >>${id("ab12cd3")}`,
    ];
    for (const text of texts) {
      const parts = text.split(LEGACY_PANEL_SPLIT_RE);
      const legacy = parts.filter((p, i) => i % 2 === 1 || p);
      const segs = splitQuoteRefs(text).map((s) => ("ref" in s ? ">>" + s.ref : s.text));
      expect(segs).toEqual(legacy);
      expect(splitQuoteRefs(text).filter((s) => "ref" in s).map((s) => (s as { author: string }).author)).toEqual(
        parts.filter((_, i) => i % 2 === 1).map(() => W),
      );
    }
  });
});
