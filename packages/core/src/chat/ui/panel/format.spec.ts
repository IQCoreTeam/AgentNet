// Pins the panel's pure formatters (chat/ui/panel/format.ts) as they shipped in the string-era
// script, so the #215 module port cannot drift a label, a unit, or a URL.
import { describe, it, expect, vi, afterEach } from "vitest";
import { S } from "./state.js";
import {
  rel, looksOnChain, fmtNoteDate, explorerTxUrl, fdAgo, feedImgUrl, agShort, pad2, splitSkillDoc,
  fmtSol, fmtPrice, netBadge, short,
} from "./format.js";

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const W = "C3EPAsjHq6DHLDzG2bXySFpUYmQ5AUqDXDfEiEsCekrH";
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

afterEach(() => { vi.useRealTimers(); });

describe("panel/format: rel, the Korean relative age", () => {
  it("counts in 방금/분/시간/일/개월/년, flooring at each unit", () => {
    vi.useFakeTimers({ now: NOW });
    expect(rel(NOW)).toBe("방금");
    expect(rel(NOW - 59 * SEC)).toBe("방금");
    expect(rel(NOW - 60 * SEC)).toBe("1분");
    expect(rel(NOW - 59 * MIN)).toBe("59분");
    expect(rel(NOW - 60 * MIN)).toBe("1시간");
    expect(rel(NOW - 23 * HOUR)).toBe("23시간");
    expect(rel(NOW - 24 * HOUR)).toBe("1일");
    expect(rel(NOW - 29 * DAY)).toBe("29일");
    expect(rel(NOW - 30 * DAY)).toBe("1개월");
    expect(rel(NOW - 359 * DAY)).toBe("11개월");
    expect(rel(NOW - 360 * DAY)).toBe("1년");
    expect(rel(NOW - 800 * DAY)).toBe("2년");
  });
  it("a timestamp in the future is 방금, never a negative age", () => {
    vi.useFakeTimers({ now: NOW });
    expect(rel(NOW + 5 * MIN)).toBe("방금");
  });
});

describe("panel/format: fdAgo, the feed row's short age", () => {
  it("formats 5s / 12m / 5h / 3d / 2w", () => {
    vi.useFakeTimers({ now: NOW });
    expect(fdAgo(NOW - 5 * SEC)).toBe("5s");
    expect(fdAgo(NOW - 12 * MIN)).toBe("12m");
    expect(fdAgo(NOW - 5 * HOUR)).toBe("5h");
    expect(fdAgo(NOW - 3 * DAY)).toBe("3d");
    expect(fdAgo(NOW - 14 * DAY)).toBe("2w");
  });
  it("rolls units at 60s / 60m / 24h / 7d", () => {
    vi.useFakeTimers({ now: NOW });
    expect(fdAgo(NOW - 59 * SEC)).toBe("59s");
    expect(fdAgo(NOW - 60 * SEC)).toBe("1m");
    expect(fdAgo(NOW - 60 * MIN)).toBe("1h");
    expect(fdAgo(NOW - 24 * HOUR)).toBe("1d");
    expect(fdAgo(NOW - 6 * DAY)).toBe("6d");
    expect(fdAgo(NOW - 7 * DAY)).toBe("1w");
  });
  it("never shows 0s: now, sub-second, and the future clamp to 1s (Math.max(1, ...))", () => {
    vi.useFakeTimers({ now: NOW });
    expect(fdAgo(NOW)).toBe("1s");
    expect(fdAgo(NOW - 999)).toBe("1s");
    expect(fdAgo(NOW + 10 * MIN)).toBe("1s");
  });
  it("no timestamp is an empty label", () => {
    expect(fdAgo(0)).toBe("");
    expect(fdAgo(undefined)).toBe("");
    expect(fdAgo(null)).toBe("");
  });
});

describe("panel/format: fmtNoteDate", () => {
  // the expectation is computed with the same Intl call, never a literal: the locale is the host's
  const noteDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  it("prefers the chain's __blockTime (seconds) over the note's own timestamp (ms)", () => {
    const blockTime = 1787813695;
    expect(fmtNoteDate({ __blockTime: blockTime, timestamp: NOW })).toBe(noteDate(blockTime * 1000));
    expect(fmtNoteDate({ timestamp: NOW })).toBe(noteDate(NOW));
  });
  it("is empty without either", () => {
    expect(fmtNoteDate({})).toBe("");
    expect(fmtNoteDate({ timestamp: 0 })).toBe("");
    expect(fmtNoteDate({ __blockTime: 0, timestamp: 0 })).toBe("");
  });
});

describe("panel/format: explorerTxUrl follows S.rpcNetwork", () => {
  const before = S.rpcNetwork;
  afterEach(() => { S.rpcNetwork = before; });
  it("mainnet has no cluster; every other network is a ?cluster= query", () => {
    S.rpcNetwork = "mainnet";
    expect(explorerTxUrl("sig1")).toBe("https://explorer.solana.com/tx/sig1");
    S.rpcNetwork = "devnet";
    expect(explorerTxUrl("sig1")).toBe("https://explorer.solana.com/tx/sig1?cluster=devnet");
  });
  it("URL-encodes both the signature and the cluster", () => {
    S.rpcNetwork = "my net";
    expect(explorerTxUrl("a/b c")).toBe("https://explorer.solana.com/tx/a%2Fb%20c?cluster=my%20net");
  });
});

describe("panel/format: feedImgUrl", () => {
  it("returns the original HTTP(S) image URL", () => {
    for (const url of ["https://example.com/cover.png", "http://example.com/a.jpg?size=2", "HTTPS://example.com/cover.png"]) {
      expect(feedImgUrl(url)).toBe(url);
    }
  });
  it("omits missing images and values the panel cannot resolve", () => {
    for (const value of ["", null, undefined, "ipfs://x", "git://example.com/x", "data:image/png;base64,AA==", "javascript:alert(1)", "//example.com/x", "/cover.png", "https:/example.com/x", W]) {
      expect(feedImgUrl(value)).toBeNull();
    }
  });
});

describe("panel/format: looksOnChain tells a base58 image id from a URL or a file name", () => {
  it("accepts an address or txid shape (32-44 base58 chars), trimmed", () => {
    expect(looksOnChain(W)).toBe(true);
    expect(looksOnChain("  " + W + "\n")).toBe(true);
    expect(looksOnChain("1".repeat(32))).toBe(true);
    expect(looksOnChain("1".repeat(44))).toBe(true);
  });
  it("refuses urls, image file names, wrong lengths, non-base58 chars, and nothing", () => {
    expect(looksOnChain("https://x/a.png")).toBe(false);
    expect(looksOnChain("HTTP://x")).toBe(false);
    expect(looksOnChain("cover.PNG")).toBe(false);
    expect(looksOnChain(W + ".jpg")).toBe(false);
    expect(looksOnChain("1".repeat(31))).toBe(false);
    expect(looksOnChain("1".repeat(45))).toBe(false);
    expect(looksOnChain("0" + "1".repeat(35))).toBe(false);
    expect(looksOnChain("")).toBe(false);
    expect(looksOnChain(undefined)).toBe(false);
  });
});

describe("panel/format: splitSkillDoc drops a leading frontmatter block", () => {
  it("strips ---/.../--- at the top, LF or CRLF, and trims what remains", () => {
    expect(splitSkillDoc("---\nname: x\ndescription: y\n---\n\n# Body\n\nhello\n")).toBe("# Body\n\nhello");
    expect(splitSkillDoc("---\r\nname: x\r\n---\r\nbody\r\n")).toBe("body");
    expect(splitSkillDoc("---\nname: x\n---")).toBe("");
  });
  it("leaves text without a leading block alone (only trimmed)", () => {
    expect(splitSkillDoc("  plain doc  ")).toBe("plain doc");
    expect(splitSkillDoc("intro\n---\nnot frontmatter\n---\n")).toBe("intro\n---\nnot frontmatter\n---");
    expect(splitSkillDoc("")).toBe("");
    expect(splitSkillDoc(undefined)).toBe("");
  });
});

describe("panel/format: address shorteners and pad2", () => {
  it("agShort keeps 6 + 4 around three dots", () => {
    expect(agShort(W)).toBe("C3EPAs...ekrH");
  });
  it("short keeps 4 + 3 around two dots, only past 10 chars", () => {
    expect(short(W)).toBe("C3EP..krH");
    expect(short("0123456789")).toBe("0123456789");
    expect(short("01234567890")).toBe("0123..890");
    expect(short("")).toBe("");
    expect(short(null)).toBe(null);
  });
  it("pad2 zero-pads a single digit and leaves the rest alone", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(7)).toBe("07");
    expect(pad2(10)).toBe("10");
    expect(pad2(123)).toBe("123");
  });
});

describe("panel/format: SOL amounts", () => {
  it("fmtSol trims trailing zeros: 4 dp under 1 SOL, 3 dp from 1 SOL", () => {
    expect(fmtSol(0)).toBe("0 SOL");
    expect(fmtSol(1_000_000_000)).toBe("1 SOL");
    expect(fmtSol(1_500_000_000)).toBe("1.5 SOL");
    expect(fmtSol(12_300_000)).toBe("0.0123 SOL");
    expect(fmtSol(1_234_567_890)).toBe("1.235 SOL");
    expect(fmtSol(10_000)).toBe("0 SOL");
    expect(fmtSol(100_000_000_000)).toBe("100 SOL");
  });
  it("fmtSol of no value is null", () => {
    expect(fmtSol(null)).toBe(null);
    expect(fmtSol(undefined)).toBe(null);
  });
  it("fmtPrice: unknown stays null, 0 is Free, else the SOL label from a lamports string", () => {
    expect(fmtPrice(null)).toBe(null);
    expect(fmtPrice(undefined)).toBe(null);
    expect(fmtPrice("abc")).toBe(null);
    expect(fmtPrice("0")).toBe("Free");
    expect(fmtPrice(0)).toBe("Free");
    expect(fmtPrice("1500000000")).toBe("1.5 SOL");
    expect(fmtPrice(250_000_000)).toBe("0.25 SOL");
  });
});

describe("panel/format: netBadge", () => {
  it("is mainnet only for 'mainnet'; everything else reads devnet", () => {
    expect(netBadge("mainnet")).toBe('<span class="netBadge mainnet">mainnet</span>');
    expect(netBadge("devnet")).toBe('<span class="netBadge devnet">devnet</span>');
    expect(netBadge("testnet")).toBe('<span class="netBadge devnet">devnet</span>');
    expect(netBadge(undefined)).toBe('<span class="netBadge devnet">devnet</span>');
  });
});
