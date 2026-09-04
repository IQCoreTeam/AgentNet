// Pins the quote card's title/snippet rule (chat/ui/panel/quoteCard.ts): what fillQuoteCard shows
// for a quoted post, exactly as the string-era panel did, including the CRLF and whitespace-only
// title corners the CLI's quoteCardLines handles differently.
import { describe, it, expect } from "vitest";
import { quoteCardModel } from "./quoteCard.js";

describe("panel/quoteCard: quoteCardModel", () => {
  it("a titled post keeps its title and quotes the whole text, trimmed, as the snippet", () => {
    expect(quoteCardModel({ title: "Release notes", text: "line one\nline two\n" }))
      .toEqual({ title: "Release notes", snippet: "line one\nline two" });
  });
  it("an untitled post promotes its trimmed first line and snips from line two", () => {
    expect(quoteCardModel({ text: "  first line  \nsecond\nthird\n" }))
      .toEqual({ title: "first line", snippet: "second\nthird" });
    expect(quoteCardModel({ text: "only one line" })).toEqual({ title: "only one line", snippet: "" });
  });
  it("empty or missing text is an empty card, never a throw", () => {
    expect(quoteCardModel({})).toEqual({ title: "", snippet: "" });
    expect(quoteCardModel({ text: "" })).toEqual({ title: "", snippet: "" });
    expect(quoteCardModel({ text: null })).toEqual({ title: "", snippet: "" });
    expect(quoteCardModel({ title: "T" })).toEqual({ title: "T", snippet: "" });
  });
  it("CRLF is not special: the split is on \\n, trim eats the promoted line's \\r, inner \\r stays", () => {
    expect(quoteCardModel({ text: "a\r\nb\r\nc" })).toEqual({ title: "a", snippet: "b\r\nc" });
  });
  it("a blank first line yields no title and the rest as the snippet", () => {
    expect(quoteCardModel({ text: "\nhello\n" })).toEqual({ title: "", snippet: "hello" });
  });
  it("a whitespace-only title still counts as a title (no trim before deciding)", () => {
    expect(quoteCardModel({ title: "  ", text: "body" })).toEqual({ title: "  ", snippet: "body" });
  });
});
