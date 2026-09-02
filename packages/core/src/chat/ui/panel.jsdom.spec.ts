// Headless render pass A (plan 4.3), the CI gate: executes the REAL chatHtml() output in jsdom,
// both inline scripts in document order, with acquireVsCodeApi stubbed before the host shim
// runs. Every scenario asserts the page raised no error, then pins one legacy behavior the
// module cut must not have moved: the boot posts and their order, the listener surviving every
// inbound type on the host's minimal shapes, the composer's exact send payload, slash menu and
// Escape interrupt, replace-semantics streaming (one bubble, no duplication), the feed's quote
// cards hydrated through getBlogPost/blogPost including the deadlink and cap cases, and the
// session list toggle plus the webview-state round trip. Layout lives in the Chrome pass.
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM, VirtualConsole, type DOMWindow } from "jsdom";
import { chatHtml } from "./webview.js";
import { QUOTE_REFS_MAX } from "../../notes/quoteRefs.js";
import { PANEL_BOOT_POSTS, PANEL_INBOUND_TYPES } from "../../../test/fixtures/panel/contract.js";
import { NOTE_ID, PANEL_INBOUND_PAYLOADS, WALLET } from "../../../test/fixtures/panel/inbound.js";

const HTML = chatHtml();
// the panel's agShort(): first six, an ellipsis, last four (the spec must not import panel/, which
// the root typecheck excludes on purpose)
const agShort = (w: string) => w.slice(0, 6) + "..." + w.slice(-4);
const OTHER_WALLET = "So11111111111111111111111111111111111111112";
const noteId = (wallet: string, ms: number, nonce: string) => `note:${wallet}:${ms}:${nonce}`;

interface Page {
  window: DOMWindow;
  document: Document;
  posted: any[];
  opened: unknown[][];
  errors: unknown[];
  getState: () => unknown;
  host: (m: object) => void;
  $: (sel: string) => HTMLElement | null;
  $$: (sel: string) => HTMLElement[];
  types: () => string[];
  frame: () => Promise<void>;
  key: (target: EventTarget, key: string) => boolean;
  fire: (target: EventTarget, type: string) => boolean;
}
let pages: Page[] = [];
afterEach(() => { for (const p of pages) p.window.close(); pages = []; });

function boot(): Page {
  const posted: any[] = [];
  const opened: unknown[][] = [];
  const errors: unknown[] = [];
  let state: any;
  const api = { postMessage: (m: any) => posted.push(m), getState: () => state, setState: (s: any) => { state = s; } };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole,
    beforeParse(window) {
      (window as any).acquireVsCodeApi = () => api;
      window.open = ((...a: unknown[]) => { opened.push(a); return null; }) as any;
    },
  });
  const { window } = dom;
  window.addEventListener("error", (e) => errors.push(e.error ?? e.message));
  const page: Page = {
    window,
    document: window.document,
    posted,
    opened,
    errors,
    getState: () => state,
    host: (m: object) => { window.dispatchEvent(new window.MessageEvent("message", { data: m })); },
    $: (sel: string) => window.document.querySelector(sel) as HTMLElement | null,
    $$: (sel: string) => Array.from(window.document.querySelectorAll(sel)) as HTMLElement[],
    types: () => posted.map((m) => m.type as string),
    frame: () => new Promise<void>((r) => window.requestAnimationFrame(() => r())),
    key: (target: EventTarget, key: string) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
    fire: (target: EventTarget, type: string) => target.dispatchEvent(new window.Event(type, { bubbles: true })),
  };
  pages.push(page);
  return page;
}

describe("panel.jsdom: boot", () => {
  it("runs both inline scripts without an error, posts the boot messages in the legacy order, and has the shell roots", () => {
    const p = boot();
    expect(p.errors).toEqual([]);
    expect((p.window as any).marked).toBeDefined();
    expect((p.window as any).DOMPurify).toBeDefined();
    expect(p.types()).toEqual(PANEL_BOOT_POSTS);
    for (const id of ["input", "log", "slashMenu", "feedList", "agFeedPost", "mktResults", "skillGrid"]) {
      expect(p.$("#" + id), "#" + id).not.toBeNull();
    }
  });
});

describe("panel.jsdom: every inbound type", () => {
  it("is dispatched without throwing on the host's minimal payload, and clear empties the log", () => {
    const p = boot();
    expect(PANEL_INBOUND_PAYLOADS.map((m) => m.type)).toEqual(PANEL_INBOUND_TYPES);
    for (const m of PANEL_INBOUND_PAYLOADS) {
      if (m.type === "clear") expect(p.$("#log")!.childElementCount).toBeGreaterThan(0);
      p.host(m);
      expect(p.errors, "after " + m.type).toEqual([]);
      if (m.type === "clear") expect(p.$("#log")!.childElementCount).toBe(0);
    }
    expect(p.opened).toEqual([["https://example.invalid/open", "_blank", "noopener,noreferrer"]]);
  });
});

describe("panel.jsdom: composer", () => {
  it("sends on Enter with exactly { type, text, images }, opens the slash menu on /mod, and interrupts on Escape while busy", () => {
    const p = boot();
    p.host({ type: "cliStatus", claude: "ok", codex: "ok" });
    const input = p.$("#input") as HTMLTextAreaElement;
    const before = p.posted.length;
    input.value = "hello";
    p.key(input, "Enter");
    expect(p.posted.slice(before)).toEqual([{ type: "send", text: "hello", images: [] }]);
    expect(input.value).toBe("");
    // the host echoes the user message; that echo is what opens the turn's sticky header
    p.host({ type: "message", msg: { role: "user", text: "hello" } });
    expect(p.$("#log .turn .turnHead .utext")!.textContent).toBe("hello");

    input.value = "/mod";
    p.fire(input, "input");
    const menu = p.$("#slashMenu")!;
    expect(menu.style.display).toBe("flex");
    expect(p.$$("#slashMenu .slashOpt .cmd").map((e) => e.textContent)).toContain("/model");

    // send() showed the typing indicator, so the turn is busy: the document-level Escape stops it
    const busyAt = p.posted.length;
    p.key(p.document, "Escape");
    expect(p.types().slice(busyAt)).toEqual(["interrupt"]);
    expect(p.errors).toEqual([]);
  });
});

describe("panel.jsdom: rate-limit gauge", () => {
  it("shows the gauge at any utilization, normalizes 0-1 fractions, and turns amber past 80%", () => {
    const p = boot();
    const meter = p.$("#limitMeter") as HTMLElement;
    const fill = () => p.$("#limitMeter .lm-fill") as HTMLElement;
    const pct = () => p.$("#limitMeter .lm-pct") as HTMLElement;

    // any percentage shows now (the gauge is the primary usage chip, not a >=50% warning)
    p.host({ type: "rateLimit", utilization: 30, window: "five_hour" });
    expect(meter.style.display).toBe("inline-flex");
    expect(pct().textContent).toBe("30%");

    // 72%: visible, filled, not warning
    p.host({ type: "rateLimit", utilization: 72, window: "five_hour", resetsAt: 1893456000000 });
    expect(fill().style.width).toBe("72%");
    expect(pct().textContent).toBe("72%");
    expect(meter.classList.contains("warn")).toBe(false);
    expect(meter.title).toContain("72%");
    expect(meter.title).toContain("5-hour");

    // a 0-1 fraction is read as a percentage: 0.73 -> 73%, not 1%
    p.host({ type: "rateLimit", utilization: 0.73, window: "five_hour" });
    expect(pct().textContent).toBe("73%");

    // 91%: warning tint
    p.host({ type: "rateLimit", utilization: 91, window: "seven_day" });
    expect(meter.classList.contains("warn")).toBe(true);
    expect(pct().textContent).toBe("91%");
    expect(p.errors).toEqual([]);
  });

  it("keeps context tokens secondary: hidden behind the gauge until clicked, shown as a fallback without it", () => {
    const p = boot();
    const meter = p.$("#limitMeter") as HTMLElement;
    const ctx = p.$("#ctxMeter") as HTMLElement;

    // no plan gauge yet: ctx shows as the fallback so the slot isn't empty
    p.host({ type: "usage", contextTokens: 12000 });
    expect(ctx.style.display).toBe("inline-flex");
    expect(ctx.textContent).toBe("ctx: 12k");

    // once the gauge has data it takes the slot and ctx hides
    p.host({ type: "rateLimit", utilization: 60, window: "five_hour" });
    expect(meter.style.display).toBe("inline-flex");
    expect(ctx.style.display).toBe("none");

    // clicking the gauge reveals ctx alongside it; clicking again hides it
    p.fire(meter, "click");
    expect(ctx.style.display).toBe("inline-flex");
    p.fire(meter, "click");
    expect(ctx.style.display).toBe("none");
    expect(p.errors).toEqual([]);
  });
});

describe("panel.jsdom: custom engine tab (issue #209)", () => {
  const CUSTOM_TAB = '#engineTabs .etab[data-cli="custom"]';
  const run = (p: Page, command: string) => {
    const input = p.$("#input") as HTMLTextAreaElement;
    input.value = command;
    p.key(input, "Enter");
  };

  it("ships hidden, refuses /engine custom without a config, and appears once the host announces one", () => {
    const p = boot();
    p.host({ type: "cliStatus", claude: "ok", codex: "ok" });
    expect(p.$(CUSTOM_TAB)!.style.display).toBe("none");
    const before = p.posted.length;
    run(p, "/engine custom");
    expect(p.types().slice(before)).toEqual([]);
    expect(p.$("#log")!.textContent).toContain("Custom engine is not configured");
    expect(p.$("#composer")!.dataset.cli).toBe("claude");

    p.host({ type: "customEngine", masked: "127.0.0.1:11667", presets: [] });
    expect(p.$(CUSTOM_TAB)!.style.display).toBe("");
    const input = p.$("#input") as HTMLTextAreaElement;
    input.value = "/engine";
    p.fire(input, "input");
    expect(p.$$("#slashMenu .slashOpt .cmd").map((e) => e.textContent)).toContain("custom");
    input.value = ""; // close the menu: an open menu makes Enter complete, not send
    p.fire(input, "input");

    const at = p.posted.length;
    run(p, "/engine custom");
    expect(p.types().slice(at)).toEqual(["platform", "model", "mode", "effort"]);
    expect(p.posted[at]).toEqual({ type: "platform", cli: "custom" });
    expect(p.posted[at + 2]).toEqual({ type: "mode", mode: "auto" }); // codex's modes, shared
    expect(p.$("#composer")!.dataset.cli).toBe("custom");
    expect(p.errors).toEqual([]);
  });

  it("reveals the tab on custom modelOptions and shows the configured model on the chip", () => {
    const p = boot();
    p.host({ type: "cliStatus", claude: "ok", codex: "ok" });
    p.host({ type: "modelOptions", cli: "custom", options: [{ value: "mock-model", chipLabel: "mock-model", label: "mock-model" }] });
    expect(p.$(CUSTOM_TAB)!.style.display).toBe("");
    run(p, "/engine custom");
    expect(p.$("#modelLabel")!.textContent).toBe("mock-model");
    expect(p.errors).toEqual([]);
  });

  it("keeps /login and /logout away from the host on the custom tab: it has no account", () => {
    const p = boot();
    p.host({ type: "cliStatus", claude: "ok", codex: "ok" });
    p.host({ type: "customEngine", masked: "127.0.0.1:11667", presets: [] });
    run(p, "/engine custom");
    const at = p.posted.length;
    run(p, "/login");
    run(p, "/logout");
    run(p, "/logout custom");
    expect(p.types().slice(at)).toEqual([]);
    expect(p.$("#log")!.textContent).toContain("Custom endpoints have no login");
    expect(p.errors).toEqual([]);
  });

  it("a null customEngine while on the tab hides it and lands the user on codex", () => {
    const p = boot();
    p.host({ type: "cliStatus", claude: "ok", codex: "ok" });
    p.host({ type: "customEngine", masked: "127.0.0.1:11667", presets: [] });
    run(p, "/engine custom");
    const at = p.posted.length;
    p.host({ type: "customEngine", masked: null, presets: [] });
    expect(p.$(CUSTOM_TAB)!.style.display).toBe("none");
    expect(p.$("#composer")!.dataset.cli).toBe("codex");
    expect(p.posted[at]).toEqual({ type: "platform", cli: "codex" });
    expect(p.$("#log")!.textContent).toContain("Custom engine was removed");
    expect(p.errors).toEqual([]);
  });

  it("marks a custom reply as custom and an unknown persisted cli as codex, live and on older pages", () => {
    const p = boot();
    p.host({ type: "message", msg: { role: "user", text: "q" } });
    p.host({ type: "message", msg: { role: "assistant", cli: "custom", text: "from the endpoint" } });
    expect(p.$("#log .node.assistant.custom .msg")!.textContent).toContain("from the endpoint");
    p.host({ type: "message", msg: { role: "assistant", cli: "future-engine", text: "from a newer build" } });
    p.host({ type: "older", messages: [
      { role: "user", text: "older q" },
      { role: "assistant", cli: "future-engine", text: "older a" },
    ], hasMore: false, cursor: null });
    // the unknown cli never reaches the class list: both nodes carry the codex mark instead
    expect(p.$$("#log .node.assistant.codex .msg").map((e) => e.textContent!.trim())).toEqual(["older a", "from a newer build"]);
    expect(p.$$('#log .node[class*="future-engine"]')).toEqual([]);
    expect(p.errors).toEqual([]);
  });
});

describe("panel.jsdom: streaming", () => {
  it("replaces the live bubble on each cumulative partial and finalizes exactly one assistant bubble", async () => {
    const p = boot();
    p.host({ type: "message", msg: { role: "user", text: "q" } });
    for (const text of ["ab", "abc", "abcd"]) {
      p.host({ type: "message", msg: { role: "assistant", cli: "claude", partial: true, text } });
      await p.frame(); // let the throttled live render paint between snapshots
    }
    expect(p.$$("#log .node.assistant .msg")).toHaveLength(1);
    expect(p.$("#log .node.assistant .msg")!.classList.contains("cursor")).toBe(true);
    p.host({ type: "message", msg: { role: "assistant", cli: "claude", partial: false, text: "abcd" } });
    const bubbles = p.$$("#log .node.assistant .msg");
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].textContent!.trim()).toBe("abcd");
    expect(bubbles[0].classList.contains("cursor")).toBe(false);
    expect(p.$("#log .node.assistant > .msgCopy")).not.toBeNull();
    expect(p.errors).toEqual([]);
  });
});

describe("panel.jsdom: feed images", () => {
  it("uses HTTP(S) URLs for list covers and reader heroes, and omits unsupported images", () => {
    const p = boot();
    const image = "https://example.com/cover.png";
    p.$("#agentsBtn")!.click();
    p.host({ type: "blogFeed", posts: [
      { id: NOTE_ID, author: WALLET, timestamp: 1725400000000, title: "Cover", image },
      { id: "unsupported", author: WALLET, timestamp: 1725400000001, title: "No cover", image: "ipfs://cover" },
    ] });
    const rows = p.$$("#feedList .fd-row");
    expect(rows[0].querySelector(".fd-cover img")!.getAttribute("src")).toBe(image);
    expect(rows[1].querySelector(".fd-cover")).toBeNull();
    rows[0].click();
    expect(p.$("#agFeedPost .fdp-hero img")!.getAttribute("src")).toBe(image);
    p.$("#agFeedPost .fdp-bar .bk")!.click();
    p.$$("#feedList .fd-row")[1].click();
    expect(p.$("#agFeedPost .fdp-hero")).toBeNull();
    expect(p.errors).toEqual([]);
  });
});

describe("panel.jsdom: feed quote cards", () => {
  const QUOTED = noteId(OTHER_WALLET, 1725400000001, "q9z2ab");
  const DEAD = noteId(OTHER_WALLET, 1725400000002, "dead01");
  const POST_TWO = noteId(WALLET, 1725400000003, "b2c3d4");
  const POST_THREE = noteId(WALLET, 1725400000004, "c3d4e5");
  const posts = [
    { id: NOTE_ID, author: WALLET, timestamp: 1725400000000, title: "Post one", text: "Look at >>" + QUOTED + " now", feedReplies: 0 },
    { id: POST_TWO, author: WALLET, timestamp: 1725400000003, title: "Post two", text: "Gone: >>" + DEAD, feedReplies: 1 },
    { id: POST_THREE, author: WALLET, timestamp: 1725400000004, title: "Post three", text: "plain", feedReplies: 0 },
  ];
  const openFeedWith = (p: Page, list: object[]) => {
    p.$("#agentsBtn")!.click();
    p.host({ type: "blogFeed", posts: list });
    return p.$$("#feedList .fd-row");
  };
  const quoteRequests = (p: Page, from: number) => p.posted.slice(from).filter((m) => m.type === "getBlogPost");

  it("renders one row per post, hydrates a >>note: ref through getBlogPost/blogPost, and marks a null reply as a deadlink", () => {
    const p = boot();
    const rows = openFeedWith(p, posts);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector(".fd-title")!.textContent)).toEqual(["Post one", "Post two", "Post three"]);

    let at = p.posted.length;
    rows[0].click();
    const loading = p.$("#agFeedPost .fd-quote.fdq-loading")!;
    expect(loading).not.toBeNull();
    expect(loading.textContent).toBe(">>resolving quote…");
    expect(p.$("#agFeedPost .fd-qref")!.textContent).toBe(">>quote:" + agShort(OTHER_WALLET));
    const reqs = quoteRequests(p, at).filter((m) => m.postId === QUOTED);
    expect(reqs).toEqual([{ type: "getBlogPost", author: OTHER_WALLET, postId: QUOTED }]);

    p.host({ type: "blogPost", postId: QUOTED, post: { author: OTHER_WALLET, title: "Quoted title", text: "Quoted body\nmore", timestamp: 1725400000001 } });
    const live = p.$("#agFeedPost .fd-quote.fdq-live")!;
    expect(live).not.toBeNull();
    expect(live.classList.contains("fdq-loading")).toBe(false);
    expect(live.querySelector(".fdq-top")!.textContent!.startsWith(">>" + agShort(OTHER_WALLET))).toBe(true);
    expect(live.querySelector(".fdq-title")!.textContent).toBe("Quoted title");
    expect(live.querySelector(".fdq-snip")!.textContent).toBe("Quoted body\nmore");

    p.$("#agFeedPost .fdp-bar .bk")!.click(); // back to the list
    at = p.posted.length;
    p.$$("#feedList .fd-row")[1].click();
    expect(quoteRequests(p, at).filter((m) => m.postId === DEAD)).toHaveLength(1);
    p.host({ type: "blogPost", postId: DEAD, post: null });
    const dead = p.$("#agFeedPost .fd-quote.fdq-dead")!;
    expect(dead).not.toBeNull();
    expect(dead.textContent).toBe(">>" + DEAD + " [not found]");
    expect(p.errors).toEqual([]);
  });

  it("cards and requests at most QUOTE_REFS_MAX refs per view, marks the rest inline, and ignores a glued ref", () => {
    const p = boot();
    const refs = Array.from({ length: QUOTE_REFS_MAX + 1 }, (_, i) => noteId(OTHER_WALLET, 1725400000100 + i, "n" + i + "abcd"));
    const glued = noteId(OTHER_WALLET, 1725400000200, "glue01") + "X";
    const text = refs.map((r) => "see >>" + r).join(" and ") + " but not >>" + glued;
    const rows = openFeedWith(p, [{ id: NOTE_ID, author: WALLET, timestamp: 1725400000000, title: "Many", text }]);
    const at = p.posted.length;
    rows[0].click();
    expect(p.$$("#agFeedPost .fd-quote")).toHaveLength(QUOTE_REFS_MAX);
    expect(p.$$("#agFeedPost .fd-qref")).toHaveLength(QUOTE_REFS_MAX + 1);
    const reqs = quoteRequests(p, at).filter((m) => m.postId !== NOTE_ID);
    expect(reqs.map((m) => m.postId)).toEqual(refs.slice(0, QUOTE_REFS_MAX));
    expect(reqs.some((m) => String(m.postId).startsWith(glued.slice(0, -1)))).toBe(false);
    expect(p.$("#agFeedPost .fdp-body")!.textContent).toContain(">>" + glued);
    expect(p.errors).toEqual([]);
  });
});

describe("panel.jsdom: sessions and webview state", () => {
  it("collapses a long session list behind 모두 보기(N), expands on click, and persists ui prefs through setState", () => {
    const p = boot();
    const list = Array.from({ length: 7 }, (_, i) => ({ sessionId: "s" + i, title: "session " + i, ts: Date.now() - i * 60_000 }));
    p.host({ type: "sessions", list, cloud: "none", activeId: "s0" });
    expect(p.$$("#sessList .sess")).toHaveLength(5);
    expect(p.$("#sessList .sess.active .title")!.textContent).toBe("session 0");
    const showAll = p.$("#showAll")!;
    expect(showAll.textContent).toBe("모두 보기(7)");
    showAll.click();
    expect(p.$$("#sessList .sess")).toHaveLength(7);
    expect(showAll.textContent).toBe("접기");

    const hideOwned = p.$("#mktHideOwned") as HTMLInputElement;
    expect(hideOwned.checked).toBe(true); // no stored pref on first run: hide owned defaults on
    hideOwned.checked = false;
    p.fire(hideOwned, "change");
    expect(p.getState()).toEqual({ hideOwnedMarket: false });
    expect(p.errors).toEqual([]);
  });
});
