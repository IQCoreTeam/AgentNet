// Headless render pass B (plan 4.4): the same chatHtml() page in a real Chromium, driven over
// the DevTools protocol with the platform WebSocket (Node 22+), so there is no driver
// dependency. It proves what jsdom cannot: the shell lays out (non-zero boxes), the slash menu
// becomes visible, and a hydrated quote card has height, with zero uncaught page exceptions.
// Locally the suite skips with a printed reason when no Chrome is found (PANEL_CHROME points at
// one); CI sets PANEL_CHROME_REQUIRED=1 so a missing browser is a loud failure, never a skip.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatHtml } from "./webview.js";
import { PANEL_BOOT_POSTS } from "../../../test/fixtures/panel/contract.js";
import { NOTE_ID, WALLET } from "../../../test/fixtures/panel/inbound.js";
import { stopChrome } from "../../../test/chrome-process.js";

const STEP_MS = 30_000;
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];
// An explicit PANEL_CHROME is authoritative (a typo reports as missing instead of silently
// falling back to another browser); otherwise the first known install location wins.
const CHROME = process.env.PANEL_CHROME
  ? (existsSync(process.env.PANEL_CHROME) ? process.env.PANEL_CHROME : null)
  : CANDIDATES.find((p) => existsSync(p)) ?? null;
const REQUIRED = process.env.PANEL_CHROME_REQUIRED === "1";
const WHERE = `PANEL_CHROME=${process.env.PANEL_CHROME ?? "unset"}, known locations: ${CANDIDATES.join(", ")}`;

// Installed before any page script: the same host stub the jsdom pass uses, recording into
// window.__posted so Runtime.evaluate can read it back by value.
const HOST_STUB = `
  window.__posted = []; window.__opened = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => window.__posted.push(m),
    getState: () => window.__state,
    setState: (s) => { window.__state = s; },
  });
  window.open = (...a) => { window.__opened.push(a); return null; };
`;

// A minimal CDP client: id-matched replies plus an event stream, flattened sessions.
class Cdp {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners: Array<(method: string, params: any, sessionId?: string) => void> = [];

  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else {
        for (const l of this.listeners) l(msg.method, msg.params, msg.sessionId);
      }
    };
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new Cdp(ws));
      ws.onerror = () => reject(new Error("could not open the DevTools socket " + url));
    });
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(fn: (method: string, params: any, sessionId?: string) => void): void {
    this.listeners.push(fn);
  }

  waitFor(method: string, sessionId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for " + method)), STEP_MS);
      this.on((m, params, sid) => {
        if (m === method && sid === sessionId) { clearTimeout(timer); resolve(params); }
      });
    });
  }

  close(): void { this.ws.close(); }
}

function launch(binary: string, profile: string, onSpawn: (proc: ChildProcess) => void): Promise<string> {
  const proc = spawn(binary, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--host-resolver-rules=MAP * ~NOTFOUND", // the shell links Google Fonts; never touch the network
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" });
  onSpawn(proc); // Keep ownership even if startup fails before printing its endpoint.
  return new Promise((resolve, reject) => {
    let err = "";
    const timer = setTimeout(() => reject(new Error("Chrome printed no DevTools endpoint within 30s:\n" + err)), STEP_MS);
    proc.stderr!.on("data", (d) => {
      err += String(d);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (${code}):\n${err}`)); });
  });
}

describe("panel.chrome: real Chromium layout of chatHtml()", () => {
  // vitest prints nothing for a file whose every test is skipped and swallows console.log from a
  // passing test, so the skip reason goes straight to stdout from this always-running test; under
  // PANEL_CHROME_REQUIRED=1 (CI) it is the failure instead
  it("has a Chrome binary, or says why the layout pass is skipped", () => {
    if (CHROME) return;
    if (REQUIRED) throw new Error("PANEL_CHROME_REQUIRED=1 but no Chrome binary was found (" + WHERE + ")");
    process.stdout.write("panel.chrome.spec: no Chrome binary found (" + WHERE + "); skipping the layout pass\n");
  });
  const layout = it.skipIf(!CHROME);

  let proc: ChildProcess | null = null;
  let closed: Promise<void> = Promise.resolve();
  let cdp: Cdp | null = null;
  let sessionId = "";
  let workDir = "";
  const exceptions: string[] = [];

  const evaluate = async <T,>(expression: string): Promise<T> => {
    const r = await cdp!.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) {
      throw new Error("evaluate failed: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result.value as T;
  };
  const host = (m: object) => evaluate<boolean>(`window.dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(m)} }))`);
  const postedTypes = () => evaluate<string[]>("window.__posted.map((m) => m.type)");

  beforeAll(async () => {
    if (!CHROME) return;
    workDir = mkdtempSync(join(tmpdir(), "agentnet-panel-chrome-"));
    const htmlPath = join(workDir, "panel.html");
    writeFileSync(htmlPath, chatHtml(), "utf8");
    const wsUrl = await launch(CHROME, join(workDir, "profile"), (child) => {
      proc = child;
      // close waits for inherited stderr as well as the launcher to exit.
      closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    });
    cdp = await Cdp.connect(wsUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    sessionId = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    cdp.on((method, params, sid) => {
      if (sid === sessionId && method === "Runtime.exceptionThrown") {
        const d = params.exceptionDetails;
        exceptions.push(d.exception?.description ?? d.text);
      }
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HOST_STUB }, sessionId);
    const loaded = cdp.waitFor("Page.loadEventFired", sessionId);
    await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href }, sessionId);
    await loaded;
  }, STEP_MS * 2);

  afterAll(async () => {
    try {
      if (proc) await stopChrome(proc, closed, cdp ? () => cdp!.send("Browser.close") : undefined);
    } finally { cdp?.close(); }
    // Chrome helpers can still be finishing profile writes after the main process exits.
    // Retry transient ENOTEMPTY/EBUSY errors; persistent cleanup failures still fail the suite.
    if (workDir) rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }, STEP_MS);

  layout("boots with no uncaught exception and posts the boot messages in the legacy order", async () => {
    expect(exceptions).toEqual([]);
    expect((await postedTypes()).slice(0, PANEL_BOOT_POSTS.length)).toEqual(PANEL_BOOT_POSTS);
  }, STEP_MS);

  layout("lays out the composer and the log with real height", async () => {
    const heights = await evaluate<number[]>(`["input", "log"].map((id) => document.getElementById(id).getBoundingClientRect().height)`);
    expect(heights.every((h) => h > 0), JSON.stringify(heights)).toBe(true);
  }, STEP_MS);

  layout("posts send on Enter from the composer", async () => {
    await host({ type: "cliStatus", claude: "ok", codex: "ok" });
    const sent = await evaluate<any[]>(`(() => {
      const input = document.getElementById("input");
      const before = window.__posted.length;
      input.value = "hello";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return window.__posted.slice(before);
    })()`);
    expect(sent).toEqual([{ type: "send", text: "hello", images: [] }]);
    expect(exceptions).toEqual([]);
  }, STEP_MS);

  layout("shows the slash menu with real height when the composer holds a slash", async () => {
    const menu = await evaluate<{ display: string; height: number; rows: number }>(`(() => {
      const input = document.getElementById("input");
      input.value = "/";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const menu = document.getElementById("slashMenu");
      return { display: getComputedStyle(menu).display, height: menu.getBoundingClientRect().height, rows: menu.querySelectorAll(".slashOpt").length };
    })()`);
    expect(menu.display).not.toBe("none");
    expect(menu.height).toBeGreaterThan(0);
    expect(menu.rows).toBeGreaterThan(0);
    expect(exceptions).toEqual([]);
  }, STEP_MS);

  layout("hydrates a quote card in the feed reader with real height and the quoted title", async () => {
    const quoted = `note:${WALLET}:1725400000001:q9z2ab`;
    await evaluate(`document.getElementById("agentsBtn").click(), true`);
    await host({ type: "blogFeed", posts: [{ id: NOTE_ID, author: WALLET, timestamp: 1725400000000, title: "Post one", text: "Look at >>" + quoted, feedReplies: 0 }] });
    await evaluate(`document.querySelector("#feedList .fd-row").click(), true`);
    await host({ type: "blogPost", postId: quoted, post: { author: WALLET, title: "Quoted title", text: "Quoted body", timestamp: 1725400000001 } });
    const card = await evaluate<{ height: number; title: string }>(`(() => {
      const card = document.querySelector("#agFeedPost .fd-quote.fdq-live");
      return { height: card ? card.getBoundingClientRect().height : 0, title: card ? card.querySelector(".fdq-title").textContent : "" };
    })()`);
    expect(card.height).toBeGreaterThan(0);
    expect(card.title).toBe("Quoted title");
    expect(exceptions).toEqual([]);
  }, STEP_MS);
});
