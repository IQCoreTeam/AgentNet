// Pins the committed panel artifact (plan 4.2). Freshness: the file is exactly what
// scripts/buildPanel.ts builds from src/chat/ui/panel/ right now, so a stale commit fails here
// instead of shipping. Shape: what chatHtml() can inline (strict IIFE, no </script, nothing
// node-only, nothing double-escaped, the Korean UI strings literal). Contract: every host
// message type the legacy script posted and handled is still there, the inbound chain keeps
// its order, and the boot posts still trail the listener. Shell: the HTML carries every id the
// panel's shared refs resolve and inlines the two scripts in the legacy order.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { bundlePanel } from "../../../scripts/buildPanel.js";
import { PANEL_SCRIPT } from "./panel.generated.js";
import { MD_LIBS } from "./mdLibs.generated.js";
import { chatHtml } from "./webview.js";
import { CHAT_MODEL_OPTIONS } from "../modelOptions.js";
import { PANEL_INBOUND_TYPES, PANEL_OUTBOUND_TYPES } from "../../../test/fixtures/panel/contract.js";

const js = PANEL_SCRIPT;
// esbuild normalizes string literals to double quotes; the legacy source used single quotes.
const quoted = (t: string) => `["']${t}["']`;
// Two login types are chosen by a ternary at one site (`type: target === "claude" ? "a" : "b"`),
// so the outbound match tolerates a same-line ternary head (under 60 chars) before the literal.
const outboundRe = (t: string) => new RegExp(`type: (?:[^\\n]{0,60}? )?${quoted(t)}`);
const inboundRe = (t: string) => new RegExp(`m\\.type === ${quoted(t)}`);

describe("panel.generated: the committed bundle is fresh", () => {
  it("equals a rebuild of src/chat/ui/panel/ byte-for-byte (run pnpm build:panel and commit when this fails)", async () => {
    expect(await bundlePanel()).toBe(js);
  }, 60_000);
});

describe("panel.generated: the bundle has the shape chatHtml() inlines", () => {
  it("is a strict-mode IIFE that parses", () => {
    expect(js.startsWith('"use strict";')).toBe(true);
    expect(() => new Function(js)).not.toThrow();
  });

  it("cannot end the inline <script> tag and reaches the browser with nothing node-only", () => {
    expect(js).not.toContain("</script");
    expect(js).not.toContain("process.");
    expect(js).not.toContain("require(");
    expect(js).not.toContain("import(");
  });

  it("carries no double-escaped newline outside comments (the template-literal un-escape sentinel)", () => {
    const escaped = js.split("\n").filter((l) => l.includes("\\\\n") && !l.trim().startsWith("//"));
    expect(escaped).toEqual([]);
  });

  it("keeps the Korean UI strings literal and stays under 400 KB", () => {
    expect(js).toContain("모두 보기");
    expect(js).toContain("접기");
    expect(js).toContain("방금");
    expect(Buffer.byteLength(js)).toBeLessThan(400 * 1024);
  });

  it("inlines every CHAT_MODEL_OPTIONS engine and model (a treeshake pass once dropped them)", () => {
    for (const [engine, options] of Object.entries(CHAT_MODEL_OPTIONS)) {
      expect(js).toMatch(new RegExp(`${engine}: \\[`));
      for (const o of options) expect(js).toContain(JSON.stringify(o.value));
    }
  });

  it("keeps the four GitHub link kind labels the panel displays", () => {
    for (const label of ["Repo", "PR", "Commit", "File"]) expect(js).toContain(JSON.stringify(label));
  });
});

describe("panel.generated: the host contract survives the cut", () => {
  it("posts every outbound type the legacy script posted", () => {
    const missing = PANEL_OUTBOUND_TYPES.filter((t) => !outboundRe(t).test(js));
    expect(missing).toEqual([]);
  });

  it("handles every inbound type in the legacy chain order", () => {
    let prev = -1;
    for (const t of PANEL_INBOUND_TYPES) {
      const idx = js.search(inboundRe(t));
      expect(idx, `m.type === "${t}"`).toBeGreaterThan(prev);
      prev = idx;
    }
  });

  it("sends ready, wallet, getBalance in that order after the listener is registered", () => {
    const listener = js.search(/window\.addEventListener\(["']message["']/);
    expect(listener).toBeGreaterThan(0);
    const last = (t: string) => Math.max(js.lastIndexOf(`type: "${t}"`), js.lastIndexOf(`type: '${t}'`));
    expect(last("ready")).toBeGreaterThan(listener);
    expect(last("wallet")).toBeGreaterThan(last("ready"));
    expect(last("getBalance")).toBeGreaterThan(last("wallet"));
  });
});

describe("panel.generated: chatHtml() still hosts the bundle", () => {
  const html = chatHtml();

  it("inlines exactly two scripts, the markdown libs before the panel", () => {
    expect(html.match(/<script\b/g)).toHaveLength(2);
    expect(html.indexOf(MD_LIBS)).toBeGreaterThan(0);
    expect(html.indexOf(PANEL_SCRIPT)).toBeGreaterThan(html.indexOf(MD_LIBS));
  });

  it("carries every element id the panel's shared refs (dom.ts) resolve at boot", () => {
    const domTs = readFileSync(new URL("./panel/dom.ts", import.meta.url), "utf8");
    const ids = [...domTs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    // every shared ref but `tabs` (a querySelectorAll) is a getElementById, so the regex saw them all
    expect(ids).toHaveLength((domTs.match(/^export const /gm) || []).length - 1);
    const shellIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    expect(ids.filter((id) => !shellIds.has(id))).toEqual([]);
    expect(html).toMatch(/class="etab\b/);
  });
});
