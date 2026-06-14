// Chat webview (HTML + inline JS). VSCode standard postMessage pattern.
//   input  -> vscode.postMessage({type:"send"})            (user -> extension)
//   render <- extension.postMessage({type:"message"|...})  (CLI output -> panel)
//
// Layout follows the codex panel reference (visual only — its code is closed):
//   top    = Platform tabs (claude code | codex)  -> postMessage {type:"platform"}
//   left   = session list: title + relative time, "모두 보기(N)" when long
//   bottom = model dropdown + input
//
// Typing effect via the contract's `partial` flag:
//   partial:true  -> append the delta to the CURRENT bubble (streaming)
//   partial:false -> that bubble is complete (start a new one next time)

import { AVATAR_SVG, AVATAR_SCRIPT } from "./avatar.js";
import { IQ_LOGO_SVG } from "./iqlogo.js";
import { MD_LIBS } from "./mdLibs.generated.js";

// marked (md → html) + dompurify (XSS sanitize) inlined into the webview <script>.
// The webview is an isolated browser context, so we ship the libraries' browser
// builds as text and run them there. marked.umd.js exposes `marked`; purify.min.js
// exposes `DOMPurify`.
//
// These are baked into ./mdLibs.generated.ts (re-run scripts/genMdLibs.mjs after a
// dep bump) rather than read at runtime: core is consumed as raw .ts and inlined by
// each surface's bundler, so a runtime readFileSync would break once bundled (the
// host's dist/ has no marked/dompurify in its node_modules). The generated constant
// is embedded as text by the bundler — zero runtime file lookup.
function markdownLibs(): string {
  return MD_LIBS;
}

// A small magic-wand glyph (line art, currentColor) — the skills affordance. Drawn
// as SVG instead of an emoji so it matches the UI weight and themes cleanly.
const WAND_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l7-7"/><path d="M9.5 4.5l2 2"/><path d="M12.5 2v2M14.5 3.5h-2M13 6.2l1 .4M12.6 1.2l.4 1"/></svg>';

export function chatHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  /* ── AgentNet tone system ──────────────────────────────────────────────
     One green accent threaded through the whole UI (the codex badge green,
     reused as THE brand accent so the app reads as "ours", not stock VSCode).
     Layered surfaces (bg-0 deepest → bg-2 raised) give cards real depth
     instead of one flat fill. All built on VSCode vars so themes still apply. */
  :root {
    --an-green:      #3ac07a;          /* brand accent (codex/brand) */
    --claude:        #e9883a;          /* claude engine accent (orange) */
    --an-green-soft: rgba(58,192,122,0.16);
    --an-green-line: rgba(58,192,122,0.38);
    --an-green-dim:  rgba(58,192,122,0.08);
    --an-amber:      #e0a23a;          /* compaction / context boundary */
    /* surface ramp — subtle, sits on top of the editor bg */
    --an-bg-1: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    --an-bg-2: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --an-line: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    --an-line-soft: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --an-radius: 12px;
    --an-radius-sm: 8px;
  }
  body { font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground);
         background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }

  /* chat / wallet panels (wallet entered via the bottom-left card, not a top tab) */
  .panel { flex: 1; display: flex; flex-direction: column; min-height: 0; }

  /* wallet/skills pages */
  .page { max-width: 520px; margin: 0 auto; padding: 28px 20px; width: 100%; box-sizing: border-box; }
  .page h2 { margin: 0 0 16px; font-size: 1.25em; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border);
          border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .card.center { text-align: center; display: flex; flex-direction: column; gap: 8px; padding: 28px; align-items: center; }
  #wAvatarBig { width: 44px; height: 44px; border-radius: 50%; overflow: hidden;
                background: var(--vscode-editor-background); margin-bottom: 4px; }
  #wAvatarBig svg { display: block; width: 100%; height: 100%; }
  .muted { opacity: 0.55; font-size: 0.85em; margin-bottom: 4px; }
  .small { font-size: 0.8em; margin-top: 8px; }
  #walletAddr { font-family: var(--vscode-editor-font-family); font-size: 0.9em; word-break: break-all; }
  .danger { width: 100%; margin-top: 4px; background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            color: var(--vscode-foreground); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); }
  .danger:hover { filter: brightness(1.15); }

  /* thin top bar: just the storage pill on the right (engine choice moved to the
     composer's folder tabs at the bottom) */
  #tabs { display: flex; align-items: center; padding: 6px 8px;
          border-bottom: 1px solid var(--vscode-panel-border); }
  #newTabBtn { background: transparent; color: var(--vscode-foreground); opacity: 0.65;
               border: 1px solid var(--an-line); border-radius: 999px; padding: 3px 12px;
               font-size: 0.78em; cursor: pointer; transition: all 0.12s; }
  #newTabBtn:hover { opacity: 1; color: var(--an-green); border-color: var(--an-green-line);
                     background: var(--an-green-dim); }
  /* storage block inside the wallet dropdown (moved from the top bar) */
  .wmSection { padding: 4px 8px 8px; border-bottom: 1px solid var(--an-line-soft); margin-bottom: 4px; }
  .wmLabel { font-size: 0.68em; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.06em;
             font-weight: 700; padding: 4px 2px 6px; display: flex; align-items: center; gap: 6px; }
  .wmStorage { display: flex; align-items: center; gap: 5px; font-size: 0.82em; opacity: 0.9;
               flex-wrap: wrap; padding: 0 2px; }
  .wmStorage .dot { font-size: 0.7em; }
  .wmStorage .dot.local { color: var(--an-green); }
  .wmStorage .dot.cloud-on { color: var(--an-green); }
  .wmStorage .dot.cloud-off { color: var(--vscode-disabledForeground, #888); }
  .wmStorage .sep { opacity: 0.3; }
  .wmStorage .acct { opacity: 0.5; }
  .wmStorage .link { background: none; border: none; padding: 0 2px; width: auto;
                     color: var(--an-green); cursor: pointer; font-size: 1em; }
  .wmStorage .link:hover { text-decoration: underline; }
  #cloudSync { font-size: 0.92em; }
  #cloudSync.ok { color: var(--an-green); }
  #cloudSync.err { color: var(--vscode-errorForeground, #e55); cursor: help; }

  #wrap { flex: 1; display: flex; min-height: 0; }

  /* ── top-bar buttons (wallet pill, history, new tab) ─────────────────────── */
  #tabs .spacer { flex: 1; }
  #tabs button { display: inline-flex; align-items: center; gap: 6px; background: transparent;
                 color: var(--vscode-foreground); border: 1px solid var(--an-line);
                 border-radius: 999px; padding: 4px 11px; font-size: 0.8em; cursor: pointer;
                 opacity: 0.8; transition: all 0.12s; }
  #tabs button:hover { opacity: 1; border-color: var(--an-green-line); background: var(--an-bg-1); }
  #tabs .caret { opacity: 0.5; font-size: 0.8em; }
  #walletPill #wAvatar { width: 18px; height: 18px; border-radius: 50%; overflow: hidden;
                         background: var(--an-bg-2); flex: none; }
  #walletPill #wAvatar svg { display: block; width: 100%; height: 100%; }
  #newTabBtn { padding: 4px 10px; font-weight: 700; }

  /* ── dropdowns (history / wallet), anchored under the top bar ─────────────── */
  /* SOLID background (an opaque widget bg, not the translucent --an-bg-2) so the
     chat behind doesn't bleed through. */
  .dropdown { position: absolute; top: 42px; z-index: 50; min-width: 260px; max-width: 340px;
              max-height: 60vh; overflow-y: auto;
              background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
              border: 1px solid var(--an-line); border-radius: var(--an-radius);
              box-shadow: 0 8px 28px rgba(0,0,0,0.4); padding: 6px; }
  #histMenu { right: 8px; }
  #walletMenu { left: 8px; }
  .ddHead { display: flex; align-items: center; justify-content: space-between;
            font-size: 0.7em; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.06em;
            font-weight: 700; padding: 6px 8px 8px; }
  .ddNew { background: transparent; color: var(--an-green); border: 1px solid var(--an-green-line);
           border-radius: 999px; padding: 2px 10px; font-size: 1em; cursor: pointer; text-transform: none; }
  .ddNew:hover { background: var(--an-green-dim); }

  .sess { display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
          padding: 8px 10px; cursor: pointer; font-size: 0.88em; border-radius: var(--an-radius-sm);
          transition: background 0.12s; }
  .sess:hover { background: var(--an-bg-1); }
  .sess.active { background: var(--an-green-dim); }
  .sess.active .title { color: var(--an-green); }
  .sess .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .sess .time { opacity: 0.45; font-size: 0.8em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sess .del { opacity: 0; font-size: 0.9em; padding: 0 2px; border-radius: 3px; }
  .sess:hover .del { opacity: 0.5; }
  .sess .del:hover { opacity: 1; background: var(--vscode-inputValidation-errorBackground); }
  #showAll { padding: 8px 10px; cursor: pointer; font-size: 0.82em; opacity: 0.6; }
  #showAll:hover { opacity: 1; color: var(--an-green); }
  #empty { opacity: 0.4; text-align: center; padding: 20px 12px; font-size: 0.85em; }

  /* wallet menu */
  .wmHead { display: flex; align-items: center; gap: 9px; padding: 8px; }
  .wmHead #wAvatar2 { width: 32px; height: 32px; border-radius: 50%; overflow: hidden;
                      background: var(--an-bg-1); flex: none; }
  .wmHead #wAvatar2 svg { display: block; width: 100%; height: 100%; }
  .wmHead .grow { min-width: 0; flex: 1; }
  #wName, #wName2 { font-size: 0.9em; font-weight: 600; }
  #wAddr { font-size: 0.74em; opacity: 0.55; font-family: var(--vscode-editor-font-family);
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wmItem { padding: 9px 10px; border-radius: var(--an-radius-sm); cursor: pointer; font-size: 0.88em;
            display: flex; align-items: center; gap: 8px; }
  .wmItem:hover:not(.disabled) { background: var(--an-bg-1); }
  .wmItem.disabled { opacity: 0.4; cursor: default; }
  .wmItem .soon { margin-left: auto; font-size: 0.72em; opacity: 0.6; border: 1px solid var(--an-line);
                  border-radius: 999px; padding: 0 7px; }

  /* right chat area */
  #main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
  #log { flex: 1; overflow-y: auto; padding: 0 0 24px; display: flex; flex-direction: column;
         scroll-behavior: smooth; position: relative; z-index: 1; }

  /* IQ watermark on an empty chat: centered, faint, theme-grey. The logo's fill is
     currentColor, so we just set color to a muted foreground that reads as grey in
     both dark and light themes. Hidden once the log has any content (.hasMsgs). */
  #watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
               pointer-events: none; z-index: 0; transition: opacity 0.3s;
               padding-bottom: 18vh; box-sizing: border-box; } /* nudge up — composer sits below */
  #watermark svg { width: 160px; height: auto; }
  /* dark theme → light grey; light theme → dark grey. Both kept faint. */
  body.vscode-dark  #watermark { color: #ffffff; opacity: 0.05; }
  body.vscode-light #watermark { color: #000000; opacity: 0.06; }
  body.vscode-high-contrast #watermark { opacity: 0.12; }
  #main.hasMsgs #watermark { opacity: 0; }

  /* loading veil while a session is carried to the other engine */
  #loading { position: absolute; inset: 0; z-index: 8; display: flex; gap: 12px;
             align-items: center; justify-content: center; flex-direction: column;
             background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
             backdrop-filter: blur(2px); font-size: 0.9em; opacity: 0.85; }
  #loading .spin { width: 26px; height: 26px; border-radius: 50%;
                   border: 2.5px solid var(--an-line); border-top-color: var(--an-green);
                   animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── TURN-THREAD layout (Claude-Code style) ──────────────────────────────
     Each user command opens a TURN: the command becomes a STICKY header that
     pins to the top while you read its replies, and the replies hang off a
     vertical timeline (a left rail + a dot per item). Scroll past a turn and the
     next command's header slides up and replaces it. */
  .turn { display: flex; flex-direction: column; }
  .turnHead { position: sticky; top: 0; z-index: 5; backdrop-filter: blur(8px);
              background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
              border-bottom: 1px solid var(--an-line-soft);
              padding: 11px 16px; display: flex; align-items: flex-start; gap: 9px; cursor: default; }
  .turnHead .uq { color: var(--an-green); font-weight: 700; flex: none; line-height: 1.5; opacity: 0.8; }
  .turnHead .utext { flex: 1; min-width: 0; white-space: pre-wrap; line-height: 1.5; font-size: 0.95em;
                     font-weight: 600; overflow-wrap: anywhere; }
  /* the timeline body: a left rail; each child item gets a dot via ::before */
  .turnBody { padding: 4px 16px 16px 16px; margin-left: 7px;
              border-left: 1.5px solid var(--an-line-soft); display: flex; flex-direction: column; gap: 2px; }
  .turn:last-child .turnBody { min-height: 40px; } /* room so the last head can pin */
  /* a reply node on the thread: dot on the rail + content */
  .node { position: relative; padding: 5px 0 5px 16px; }
  .node::before { content: ''; position: absolute; left: -7px; top: 12px; width: 9px; height: 9px;
                  border-radius: 50%; background: var(--an-bg-2); border: 1.5px solid var(--an-line);
                  box-sizing: border-box; }
  /* the timeline dot doubles as an ENGINE MARK: claude=orange, codex=green, so each
     reply shows which engine produced it right on the rail. A subtle ring + glow. */
  .node.assistant::before { background: var(--an-green); border-color: var(--an-green);
                            box-shadow: 0 0 0 3px var(--an-green-dim); }
  .node.assistant.claude::before { background: var(--claude); border-color: var(--claude);
                                   box-shadow: 0 0 0 3px rgba(233,136,58,0.16); }
  .node.thinking::before  { background: transparent; }
  .msg { white-space: pre-wrap; line-height: 1.55; font-size: 0.95em; overflow-wrap: anywhere; }
  /* rendered markdown inside an assistant message: tame the default browser margins
     and theme code/tables/quotes to match. (assistant .msg holds sanitized HTML.) */
  .node.assistant .msg { white-space: normal; }
  .msg > :first-child { margin-top: 0; }
  .msg > :last-child { margin-bottom: 0; }
  .msg p { margin: 0 0 8px; }
  .msg h1, .msg h2, .msg h3, .msg h4 { margin: 14px 0 6px; line-height: 1.3; font-weight: 700; }
  .msg h1 { font-size: 1.3em; } .msg h2 { font-size: 1.18em; } .msg h3 { font-size: 1.06em; } .msg h4 { font-size: 1em; }
  .msg ul, .msg ol { margin: 4px 0 8px; padding-left: 1.4em; }
  .msg li { margin: 2px 0; }
  .msg a { color: var(--an-green); text-decoration: none; }
  .msg a:hover { text-decoration: underline; }
  .msg code { font-family: var(--vscode-editor-font-family); font-size: 0.88em;
              background: var(--an-bg-1); border: 1px solid var(--an-line-soft);
              border-radius: 4px; padding: 1px 5px; }
  .msg pre { background: var(--an-bg-1); border: 1px solid var(--an-line-soft);
             border-radius: var(--an-radius-sm); padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
  .msg pre code { background: none; border: none; padding: 0; font-size: 0.86em; line-height: 1.5; }
  .msg blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--an-line);
                    opacity: 0.85; }
  .msg table { border-collapse: collapse; margin: 8px 0; font-size: 0.92em; display: block; overflow-x: auto; }
  .msg th, .msg td { border: 1px solid var(--an-line); padding: 5px 10px; text-align: left; }
  .msg th { background: var(--an-bg-1); font-weight: 600; }
  .msg hr { border: none; border-top: 1px solid var(--an-line); margin: 12px 0; }
  .msg strong { font-weight: 700; }
  .msg img { max-width: 100%; border-radius: var(--an-radius-sm); }

  /* per-message copy button: appears on hover at the node's top-right (Claude-style) */
  .copyBtn { position: absolute; top: 2px; right: 4px; width: 24px; height: 24px; padding: 0;
             display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
             background: var(--an-bg-2); border: 1px solid var(--an-line-soft); border-radius: 6px;
             color: var(--vscode-foreground); opacity: 0; transition: opacity 0.12s, color 0.12s; }
  .node:hover .copyBtn { opacity: 0.7; }
  .copyBtn:hover { opacity: 1; color: var(--an-green); border-color: var(--an-green-line); }
  .copyBtn svg { width: 13px; height: 13px; }
  .copyBtn.done { color: var(--an-green); opacity: 1; }
  .node.assistant .msg { }
  .node.thinking .msg { opacity: 0.5; font-style: italic; font-size: 0.9em; }
  .tool { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }

  /* collapse long bodies (summaries) behind a fade + show more */
  .msg.clamp, .summaryBody.clamp { max-height: 8lh; overflow: hidden; position: relative; }
  .moreBtn { font-size: 0.78em; opacity: 0.6; cursor: pointer; margin: 2px 0 4px;
             background: none; border: none; color: var(--vscode-foreground); width: auto; padding: 2px; }
  .moreBtn:hover { opacity: 1; color: var(--an-green); }

  /* turn footer under an assistant reply: elapsed time + model, tabular & quiet */
  .footer { display: flex; align-items: center; gap: 7px; margin: 0 4px 4px; font-size: 0.7em;
            opacity: 0.45; font-variant-numeric: tabular-nums; }
  .footer .mdl { opacity: 0.8; }

  /* context-compaction boundary: an amber rule that says "history was summarized here" */
  .compactRule { display: flex; align-items: center; gap: 9px; align-self: stretch; max-width: 100%;
                 margin: 12px 2px; user-select: none; }
  .compactRule .ln { flex: 1; height: 1px; background: color-mix(in srgb, var(--an-amber) 32%, transparent); }
  .compactRule .lbl { font-size: 0.7em; letter-spacing: 0.04em; text-transform: uppercase;
                      color: var(--an-amber); opacity: 0.85; display: inline-flex; align-items: center; gap: 5px;
                      font-family: var(--vscode-editor-font-family); }
  .summaryBody { margin: 4px 0 6px; padding: 10px 13px;
                 font-size: 0.86em; line-height: 1.5; opacity: 0.72; white-space: pre-wrap;
                 border-left: 2px solid color-mix(in srgb, var(--an-amber) 45%, transparent);
                 background: color-mix(in srgb, var(--an-amber) 6%, transparent);
                 border-radius: 0 var(--an-radius-sm) var(--an-radius-sm) 0; }

  /* tool action cards: what the agent actually DID (bash / diff / file op).
     A quiet raised surface with a faint border; the HEAD is a thin monospace row
     (icon + command), output below a hairline. "soft bg / bright text" + chevron. */
  .toolCard { font-family: var(--vscode-editor-font-family); font-size: 0.8em;
              border: 1px solid var(--an-line-soft); border-radius: var(--an-radius-sm);
              margin: 5px 0; overflow: hidden; background: var(--an-bg-1); }
  .toolCard.op { padding: 6px 11px; opacity: 0.75; display: flex; align-items: center; gap: 7px; }
  .toolCard.op .icon { opacity: 0.6; }
  /* expandable head: a <details>/<summary>-style row with a rotating chevron */
  .toolHead { padding: 7px 11px; display: flex; gap: 7px; align-items: center;
              cursor: default; line-height: 1.4; }
  .toolHead.clickable { cursor: pointer; user-select: none; }
  .toolHead.clickable:hover { background: var(--an-bg-2); }
  .toolHead .chev { width: 11px; height: 11px; flex: none; opacity: 0.5;
                    transition: transform 0.15s ease; }
  .toolHead.open .chev { transform: rotate(90deg); }
  .toolHead .tk { color: var(--an-green); font-weight: 700; flex: none; }
  .toolHead .cmd { white-space: pre-wrap; word-break: break-all; color: var(--vscode-foreground);
                   opacity: 0.92; min-width: 0; flex: 1; }
  .toolHead .file { opacity: 0.92; min-width: 0; flex: 1; overflow: hidden;
                    text-overflow: ellipsis; white-space: nowrap; }
  /* inline +/- stat on edit cards (emerald / red, OpenGUI-style) */
  .toolHead .stat { margin-left: auto; flex: none; font-size: 0.92em;
                    display: inline-flex; gap: 5px; font-variant-numeric: tabular-nums; }
  .toolHead .stat .plus { color: var(--an-green); }
  .toolHead .stat .minus { color: #e06c6c; }
  .toolCard.failed .toolHead { background: rgba(224,108,108,0.10); }
  .toolCard.failed .tk { color: #e06c6c; }
  .toolOut { margin: 0; padding: 8px 11px; max-height: 220px; overflow: auto;
             white-space: pre-wrap; word-break: break-all; opacity: 0.8; font-size: 0.95em;
             border-top: 1px solid var(--an-line-soft); }
  .toolBody[hidden] { display: none; }
  .diffBody { margin: 0; padding: 5px 0; max-height: 320px; overflow: auto;
              border-top: 1px solid var(--an-line-soft); line-height: 1.5; }
  .diffBody > div { padding: 0 11px 0 6px; white-space: pre-wrap; word-break: break-all; }
  .diffBody .gut { display: inline-block; width: 14px; text-align: center; opacity: 0.5;
                   user-select: none; flex: none; }
  .diffBody .add { background: var(--an-green-dim); color: var(--an-green); }
  .diffBody .del { background: rgba(224,108,108,0.10); color: #e07a7a; }
  .diffBody .ctx { opacity: 0.5; }
  .diffBody .fold { opacity: 0.35; padding: 1px 11px; user-select: none; font-style: italic; }

  /* approval DOCK: pending tool approvals sit here, pinned just above the composer
     (Claude-Code style) — separate from the scrolling log so "what to answer now"
     is always in reach. Empty = collapsed (no border/padding). */
  #approvalDock { display: flex; flex-direction: column; gap: 6px; }
  #approvalDock:not(:empty) { padding: 8px 12px 0; }

  /* tool-APPROVAL card: like a tool card but actionable — green ring + buttons. */
  .approvalCard { border: 1px solid var(--an-green-line); border-radius: var(--an-radius-sm);
                  background: var(--an-green-dim); overflow: hidden;
                  box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
  .apHead { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
            font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
  .apHead .apk { color: var(--an-green); font-weight: 700; }
  .apTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .apTag { font-size: 0.78em; opacity: 0.6; text-transform: lowercase; padding: 1px 7px;
           border: 1px solid var(--an-line); border-radius: 999px; }
  .apBody { margin: 0; padding: 8px 12px; font-family: var(--vscode-editor-font-family);
            font-size: 0.8em; white-space: pre-wrap; word-break: break-all; opacity: 0.9;
            border-top: 1px solid var(--an-green-dim); max-height: 240px; overflow: auto; }
  .apActions { display: flex; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--an-green-dim); }
  .apBtn { width: auto; padding: 6px 16px; font-size: 0.85em; font-weight: 600; border-radius: 6px;
           outline: none; transition: box-shadow 0.12s, filter 0.12s; }
  .apBtn.ok { background: var(--an-green); color: #06231a; }
  .apBtn.ok:hover { filter: brightness(1.08); }
  .apBtn.always { background: transparent; color: var(--an-green); border: 1px solid var(--an-green-line); }
  .apBtn.always:hover { background: var(--an-green-dim); }
  .apBtn.no { background: transparent; color: #e07a7a; border: 1px solid rgba(224,108,108,0.4); }
  .apBtn.no:hover { background: rgba(224,108,108,0.12); }
  /* keyboard focus ring (← → to move, Enter to confirm) */
  .apBtn:focus-visible, .apBtn:focus { box-shadow: 0 0 0 2px var(--vscode-editor-background),
                                                    0 0 0 4px var(--an-green); }
  .apBtn.no:focus-visible, .apBtn.no:focus { box-shadow: 0 0 0 2px var(--vscode-editor-background),
                                                          0 0 0 4px #e07a7a; }
  .apResolved { padding: 8px 12px; font-size: 0.82em; border-top: 1px solid var(--an-green-dim); }
  .apResolved.allowed { color: var(--an-green); }
  .apResolved.denied { color: #e07a7a; }
  .cursor::after { content: "\\u258B"; opacity: 0.6; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  /* "claude is working" typing indicator (animated dots) */
  .typing { display: flex; align-items: center; gap: 8px; opacity: 0.85; }
  .typing .who { font-size: 0.8em; opacity: 0.6; text-transform: lowercase; }
  .typing .dots { display: inline-flex; gap: 4px; }
  .typing .dots i { width: 6px; height: 6px; border-radius: 50%;
                    background: var(--an-green); opacity: 0.5;
                    animation: typingBounce 1.2s infinite ease-in-out; }
  .typing .dots i:nth-child(2) { animation-delay: 0.18s; }
  .typing .dots i:nth-child(3) { animation-delay: 0.36s; }
  @keyframes typingBounce { 0%,60%,100% { transform: translateY(0); opacity: 0.35; }
                            30% { transform: translateY(-4px); opacity: 0.9; } }

  /* platform badge chip under an assistant bubble */
  .badge { font-size: 0.62em; opacity: 0.85; margin: 0 4px 3px; padding: 1px 8px;
           border-radius: 999px; font-weight: 600; letter-spacing: 0.03em;
           border: 1px solid transparent; display: inline-flex; align-items: center; gap: 4px; }
  .badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .badge.claude { color: #e9883a; border-color: #e9883a44; background: #e9883a14; }
  .badge.codex  { color: var(--an-green); border-color: var(--an-green-line); background: var(--an-green-dim); }

  /* ── COMPOSER: engine folder-tabs + input + controls ─────────────────────
     The engine (claude/codex) is chosen by FOLDER TABS at the top-right of the
     input: the active one sits IN FRONT (connected to the input box), the other
     tucks behind. Picking claude tints the whole composer ORANGE; codex stays
     neutral — so the input itself signals which engine you're talking to. */
  #composer { padding: 8px 12px 12px; border-top: 1px solid var(--an-line-soft);
              display: flex; flex-direction: column; }
  /* per-engine accent: a single var the composer themes off of */
  #composer { --eng: var(--an-green); --engSoft: var(--an-green-dim); --engLine: var(--an-green-line); }
  #composer[data-cli="claude"] { --eng: var(--claude); --engSoft: rgba(233,136,58,0.12); --engLine: rgba(233,136,58,0.45); }

  /* composer top row: skills (left) ←→ engine tabs (right) */
  #composerTop { display: flex; align-items: flex-end; justify-content: space-between; }
  #skillsBtn { display: inline-flex; align-items: center; gap: 6px; background: var(--an-bg-1);
               color: var(--vscode-foreground); border: 1px solid var(--an-line-soft); border-bottom: none;
               border-radius: var(--an-radius-sm) var(--an-radius-sm) 0 0; padding: 5px 12px 7px;
               font-size: 0.8em; cursor: pointer; opacity: 0.7; position: relative; top: 1px;
               transition: opacity 0.12s, color 0.12s; }
  #skillsBtn:hover { opacity: 1; color: var(--an-green); }
  #skillsBtn.on { opacity: 1; color: var(--an-green); background: var(--an-bg-2); border-color: var(--an-green-line); }
  #skillsBtn .wand { display: inline-flex; width: 14px; height: 14px; }
  .wand { display: inline-flex; width: 13px; height: 13px; vertical-align: -2px; }

  /* equipped-skills panel (above the composer) */
  #skillsPanel { margin: 8px 12px 0; border: 1px solid var(--an-line); border-radius: var(--an-radius);
                 background: var(--vscode-editorWidget-background, var(--an-bg-2)); padding: 10px 12px; }
  #skillsPanel .skHead { display: flex; align-items: center; gap: 7px; font-size: 0.78em;
                         font-weight: 600; opacity: 0.85; margin-bottom: 9px; }
  #skillsPanel .skHead .wand { width: 14px; height: 14px; color: var(--an-green); }
  #skillsPanel .skMuted { margin-left: auto; font-weight: 400; opacity: 0.5; font-size: 0.92em; }
  #skillGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  /* a skill slot: an item card. empty = a quiet dashed "coming soon" placeholder. */
  .skSlot { aspect-ratio: 1; border-radius: var(--an-radius-sm); display: flex; align-items: center;
            justify-content: center; }
  .skSlot.empty { border: 1.5px dashed var(--an-line-soft); background: var(--an-bg-1); opacity: 0.5; }
  .skSlot.empty::after { content: ''; width: 16px; height: 16px; border-radius: 4px;
                         background: var(--an-line-soft); }
  /* an ACTIVE skill = a live item card: green-edged, gently breathing glow (not neon) */
  .skSlot.item { flex-direction: column; gap: 5px; padding: 8px 6px; aspect-ratio: auto;
                 border: 1px solid var(--an-green-line); background: var(--an-green-dim);
                 color: var(--an-green); position: relative; overflow: hidden;
                 animation: skBreath 3.2s ease-in-out infinite; }
  .skSlot.item .skWand { width: 18px; height: 18px; display: inline-flex; filter: drop-shadow(0 0 4px var(--an-green)); }
  .skSlot.item .skName { font-size: 0.72em; color: var(--vscode-foreground); opacity: 0.92;
                         text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                         max-width: 100%; }
  @keyframes skBreath {
    0%, 100% { box-shadow: 0 0 0 0 transparent; border-color: var(--an-green-line); }
    50%      { box-shadow: 0 0 10px -2px var(--an-green); border-color: var(--an-green); }
  }
  /* header "Casting: …" glows softly when something is active */
  #skillsPanel.casting .skMuted { color: var(--an-green); opacity: 0.95; font-weight: 600;
                                  text-shadow: 0 0 8px color-mix(in srgb, var(--an-green) 55%, transparent); }
  /* the skills BUTTON also hints when casting (badge already shows the count) */
  #skillsBtn.casting { color: var(--an-green); }
  .skNote { margin-top: 10px; font-size: 0.76em; opacity: 0.5; line-height: 1.5; }

  /* passive skill-shopping toggle row (issue #21) */
  #shopToggleRow { display: flex; align-items: center; gap: 7px; margin-top: 10px;
                   padding-top: 9px; border-top: 1px solid var(--an-line); font-size: 0.82em; }
  #shopToggleLabel { font-weight: 600; }
  .shopToggleHint { opacity: 0.5; font-size: 0.92em; flex: 1; min-width: 0;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #shopToggle { position: relative; width: 32px; height: 18px; flex: none; border-radius: 999px;
                background: var(--an-bg-2); border: 1px solid var(--an-line); cursor: pointer; padding: 0;
                transition: background 0.15s, border-color 0.15s; }
  #shopToggle .knob { position: absolute; top: 1px; left: 1px; width: 14px; height: 14px;
                      border-radius: 50%; background: var(--an-fg, currentColor); opacity: 0.6;
                      transition: left 0.15s, opacity 0.15s; }
  #shopToggle.on { background: var(--an-green-dim); border-color: var(--an-green-line); }
  #shopToggle.on .knob { left: 15px; background: var(--an-green); opacity: 1; }

  /* marketplace shop inside the skills panel */
  #skillShop { margin-top: 10px; }
  #skillShop .shopRow { display: flex; gap: 6px; }
  #skillSearch { flex: 1; min-width: 0; background: var(--an-bg); border: 1px solid var(--an-line);
                 border-radius: var(--an-radius); color: inherit; padding: 5px 9px; font-size: 0.82em; outline: none; }
  #skillSearch:focus { border-color: var(--an-green-line); }
  #skillSearchBtn { background: var(--an-green-dim); border: 1px solid var(--an-green-line); color: var(--an-green);
                    border-radius: var(--an-radius); padding: 5px 11px; font-size: 0.82em; cursor: pointer; }
  #skillResults { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .shopItem { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--an-line);
              border-radius: var(--an-radius); font-size: 0.82em; }
  .shopItem .si-main { min-width: 0; flex: 1; }
  .shopItem .si-name { font-weight: 600; }
  .shopItem .si-desc { opacity: 0.6; font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shopItem .si-sup { opacity: 0.5; font-size: 0.92em; white-space: nowrap; }
  .shopItem .si-buy { background: var(--an-green-dim); border: 1px solid var(--an-green-line); color: var(--an-green);
                      border-radius: var(--an-radius); padding: 4px 10px; cursor: pointer; white-space: nowrap; }
  .shopItem .si-buy[disabled] { opacity: 0.5; cursor: default; }
  #skillResults .shopEmpty { opacity: 0.5; font-size: 0.8em; padding: 4px 2px; }

  /* skill marquee — ONLY shows when an equipped skill fires ("Casting <skill>").
     Plain tool work isn't shown here (it's already in the chat timeline). Green with
     a breathing glow so a skill firing feels like the agent wielding its power. */
  #activityBar { margin: 6px 12px 0; padding: 6px 12px; border-radius: 999px;
                 background: var(--an-green-dim); border: 1px solid var(--an-green-line);
                 color: var(--an-green); font-size: 0.8em;
                 display: flex; align-items: center; gap: 8px; overflow: hidden; white-space: nowrap;
                 animation: actBreath 2.6s ease-in-out infinite, actIn 0.25s ease-out; }
  #activityBar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--an-green); flex: none;
                      box-shadow: 0 0 6px var(--an-green); animation: actPulse 1.4s ease-in-out infinite; }
  #activityText { overflow: hidden; text-overflow: ellipsis; }
  #activityText .verb { font-weight: 700; text-shadow: 0 0 8px color-mix(in srgb, var(--an-green) 50%, transparent); }
  #activityText .obj { opacity: 0.85; color: var(--vscode-foreground); font-family: var(--vscode-editor-font-family); font-size: 0.94em; }
  @keyframes actBreath { 0%,100% { box-shadow: 0 0 0 0 transparent; }
                         50% { box-shadow: 0 0 12px -3px var(--an-green); } }
  @keyframes actPulse  { 0%,100% { opacity: 0.4; transform: scale(0.85); }
                         50% { opacity: 1; transform: scale(1.1); } }
  @keyframes actIn     { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  #activityBar.out { animation: actOut 0.25s ease-in forwards; }
  @keyframes actOut    { to { opacity: 0; transform: translateY(4px); } }
  .skNote code { font-family: var(--vscode-editor-font-family); font-size: 0.95em;
                 background: var(--an-bg-1); padding: 0 4px; border-radius: 3px; }

  #engineTabs { display: flex; gap: 3px; align-self: flex-end; }
  .etab { display: flex; align-items: center; gap: 6px; padding: 5px 14px 7px;
          font-size: 0.8em; cursor: pointer; user-select: none; opacity: 0.5;
          background: var(--an-bg-1); border: 1px solid var(--an-line-soft); border-bottom: none;
          border-radius: var(--an-radius-sm) var(--an-radius-sm) 0 0; position: relative; top: 1px;
          transition: opacity 0.12s, background 0.12s; }
  .etab:hover { opacity: 0.8; }
  .etab .ed { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.5; }
  .etab[data-cli="claude"] { color: var(--claude); }
  .etab[data-cli="codex"]  { color: var(--an-green); }
  /* the ACTIVE tab pops forward: full opacity, raised, merged into the input box */
  .etab.active { opacity: 1; background: var(--an-bg-2); border-color: var(--engLine);
                 border-bottom: 1px solid var(--an-bg-2); top: 2px; z-index: 2; font-weight: 600; }
  .etab.active .ed { opacity: 1; }

  #inputWrap { border: 1.5px solid var(--engLine); border-radius: var(--an-radius-sm);
               background: var(--an-bg-2); overflow: hidden; transition: border-color 0.12s; }
  #input { width: 100%; box-sizing: border-box; padding: 11px 12px 8px; background: transparent;
           color: var(--vscode-input-foreground); border: none; resize: none; font-family: inherit;
           font-size: 0.95em; display: block; }
  #input:focus { outline: none; }
  #input:disabled { opacity: 0.5; cursor: not-allowed; }
  #inputWrap:focus-within { box-shadow: 0 0 0 2px var(--engSoft); }
  /* composer frozen while a tool approval is pending (input value is kept, just locked) */
  #composer.locked #inputWrap { opacity: 0.6; }
  #composer.locked #send { opacity: 0.4; cursor: not-allowed; }

  #controls { display: flex; gap: 8px; align-items: center; padding: 4px 8px 7px; font-size: 0.82em; }
  #model { background: var(--an-bg-1); color: var(--vscode-foreground);
           border: 1px solid var(--an-line); border-radius: 6px; padding: 3px 7px; font-size: 0.92em; }
  #autoEdit { display: flex; align-items: center; gap: 4px; opacity: 0.7; cursor: pointer; font-size: 0.92em; }
  #autoEdit input { margin: 0; accent-color: var(--eng); }
  #send { margin-left: auto; padding: 6px 16px; background: var(--eng); color: #1a1205; font-weight: 600;
          border: none; border-radius: 6px; cursor: pointer; }
  #composer[data-cli="codex"] #send { color: #06231a; }
  #send:hover { filter: brightness(1.08); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; border-radius: 6px; cursor: pointer; }
</style>
</head>
<body>
  <!-- No top tab bar: the wallet card (bottom-left) is the entry to My Wallet. -->

  <!-- CHAT view -->
  <div id="chatView" class="panel">
  <!-- top bar: wallet menu (left) · history + new-tab + storage (right). No left
       sidebar — sessions live in the History dropdown now. -->
  <div id="tabs">
    <!-- wallet pill: shows the agent; click → a menu (skills etc., grows later) -->
    <button id="walletPill" title="My Wallet">
      <span id="wAvatar"></span>
      <span id="wName">My Wallet</span>
      <span class="caret">▾</span>
    </button>
    <div class="spacer"></div>
    <button id="histBtn" title="Recent chats">↻ History <span class="caret">▾</span></button>
    <button id="newTabBtn" title="Open another chat in a new tab">+</button>
  </div>

  <!-- History dropdown (session list), anchored under the History button -->
  <div id="histMenu" class="dropdown" style="display:none">
    <div class="ddHead">Recent chats <button id="newBtn" class="ddNew">+ New</button></div>
    <div id="sessList"></div>
    <div id="showAll" style="display:none"></div>
    <div id="empty" style="display:none">No chats yet. Start one below.</div>
  </div>

  <!-- Wallet dropdown (agent menu — storage, skills, grows later) -->
  <div id="walletMenu" class="dropdown" style="display:none">
    <div class="wmHead">
      <span id="wAvatar2"></span>
      <div class="grow">
        <div id="wName2">My Wallet</div>
        <div id="wAddr" class="muted">connecting…</div>
      </div>
    </div>
    <!-- storage / Google Drive info, moved here from the top bar -->
    <div class="wmSection">
      <div class="wmLabel">Storage <span id="cloudSync" title="Drive sync status"></span></div>
      <div class="wmStorage">
        <span class="dot local">●</span><span>Local</span>
        <span class="sep">·</span>
        <span id="cloudState"></span>
        <button id="cloudBtn" class="link"></button>
      </div>
    </div>
    <div class="wmItem" id="openWalletPage">Wallet page</div>
    <div class="wmItem disabled"><span class="wand">${WAND_SVG}</span> Skills <span class="soon">soon</span></div>
  </div>

  <div id="wrap">
    <div id="main">
      <!-- faint IQ watermark, shown only on an empty (new) chat -->
      <div id="watermark">${IQ_LOGO_SVG}</div>
      <!-- loading veil shown while a session is being carried to the other engine -->
      <div id="loading" style="display:none"><div class="spin"></div><span>Resuming…</span></div>
      <div id="log"></div>
      <!-- pending tool approvals dock just above the composer (Claude-Code style:
           "the thing you must answer" sits right where you'd reply) -->
      <div id="approvalDock"></div>
      <!-- equipped-skills panel (toggled by #skillsBtn) — the agent's "magic items".
           Real now: a header + empty grey slots that say drops aren't live yet. -->
      <div id="skillsPanel" style="display:none">
        <div class="skHead">
          <span class="wand">${WAND_SVG}</span>
          <span>Equipped skills</span>
          <span class="skMuted" id="skillStatus">none active</span>
        </div>
        <div id="skillGrid">
          <!-- coming-soon grey slots (no lie: nothing equipped yet) -->
          <div class="skSlot empty"></div>
          <div class="skSlot empty"></div>
          <div class="skSlot empty"></div>
        </div>
        <!-- marketplace: search the on-chain catalog, buy a soulbound skill, and it's
             installed into the runtime's skills dir (discovered next session). -->
        <!-- passive skill-shopping toggle (issue #21): ON = the agent shops for a
             missing capability (verify → confirm → buy); OFF = owned-only, never buys. -->
        <div id="shopToggleRow">
          <label id="shopToggleLabel" for="shopToggle">Shop for me</label>
          <span class="shopToggleHint">agent buys skills it needs (with your OK)</span>
          <button id="shopToggle" role="switch" aria-checked="true" class="on" title="Toggle passive skill-shopping"><span class="knob"></span></button>
        </div>
        <div id="skillShop">
          <div class="shopRow">
            <input id="skillSearch" type="text" placeholder="Search skills to buy…" />
            <button id="skillSearchBtn">Search</button>
          </div>
          <div id="skillResults"></div>
        </div>
      </div>
      <!-- activity marquee: a thin status bar that flashes what the agent is doing
           right now ("Casting cleancode", "Reading auth.ts") with a breathing glow,
           then fades. Empty/hidden when idle. -->
      <div id="activityBar" style="display:none"><span class="dot"></span><span id="activityText"></span></div>
      <!-- composer: skills (top-left) + engine folder-tabs (top-right), input, controls -->
      <div id="composer" data-cli="claude">
        <div id="composerTop">
          <!-- equipped-skills button: a wand glyph + count badge. Click → skill dock. -->
          <button id="skillsBtn" title="Equipped skills">
            <span class="wand">${WAND_SVG}</span>
            <span>Skills</span>
          </button>
          <div id="engineTabs">
            <div class="etab active" data-cli="claude"><span class="ed"></span>claude</div>
            <div class="etab" data-cli="codex"><span class="ed"></span>codex</div>
          </div>
        </div>
        <div id="inputWrap">
          <textarea id="input" rows="1" placeholder="Message claude... (Enter to send)"></textarea>
          <div id="controls">
            <select id="model"></select>
            <label id="autoEdit" title="Auto-approve edits (skip the approval card for file edits)">
              <input type="checkbox" id="autoEditChk" /> auto-edit
            </label>
            <button id="send">Send</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div><!-- /chatView -->

  <!-- MY WALLET view (Skills now lives INSIDE here) -->
  <div id="walletView" class="panel" style="display:none">
    <div class="page">
      <div id="backToChat" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
      <div class="card center">
        <div id="wAvatarBig"></div>
        <div class="addr" id="walletAddr">…</div>
        <div class="muted small" style="margin-top:0">This wallet is your agent.</div>
      </div>
      <div class="card">
        <div class="muted">Storage</div>
        <div id="walletStorage">…</div>
      </div>
      <div class="card">
        <div class="muted">Skills</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          <div style="font-size:1.6em">🧩</div>
          <div>
            <div>On-chain skills are coming soon.</div>
            <div class="muted small" style="margin-top:2px">Buy, equip, and collect agent skills (Token-2022, soulbound). Not live yet.</div>
          </div>
        </div>
      </div>
      <button class="danger" id="disconnectWalletBtn">Disconnect wallet</button>
      <div class="muted small">Disconnecting returns you to the connect screen. Your encrypted local sessions stay on this device.</div>
    </div>
  </div>
<!-- markdown libs (marked + dompurify), inlined; expose window.marked / window.DOMPurify -->
<script>${markdownLibs()}</script>
<script>
  const AVATAR_SVG = ${JSON.stringify(AVATAR_SVG)};
  ${AVATAR_SCRIPT}
  // The host pipe. Inside VSCode it's acquireVsCodeApi(); in a browser/Android WebView
  // there's no such global, so we fall back to HTTP-RPC + SSE that speaks the SAME
  // shape: postMessage(obj) → POST /rpc (UI→server commands); the server's SSE stream
  // (GET /events, server→UI) is re-dispatched as window 'message' events. So every
  // \`vscode.postMessage(...)\` and \`addEventListener('message',...)\` below works
  // unchanged on any surface (CODE-RULES: one UI, no per-platform fork). SSE auto-
  // reconnects; we keep the server-issued client id so a dropped stream replays the
  // events it missed (steadier than WebSocket in an Android WebView).
  const vscode = (typeof acquireVsCodeApi === "function")
    ? acquireVsCodeApi()
    : (() => {
        let clientId = null;
        const outbox = []; // commands queued until we have a client id
        function post(s) {
          fetch("/rpc?client=" + encodeURIComponent(clientId), {
            method: "POST", headers: { "content-type": "application/json" }, body: s,
          }).catch(() => {}); // a dropped command is recovered by the UI's next action
        }
        // Open the SSE stream. On the first connect the server sends {client} which we
        // tag onto every POST; we then reopen the stream WITH the id in the URL so the
        // browser's auto-reconnect (carrying Last-Event-ID) lands on the same client
        // and replays. Inbound data frames become window 'message' events.
        function open(url) {
          const es = new EventSource(url);
          es.addEventListener("client", (e) => {
            const id = JSON.parse(e.data).client;
            if (clientId === null) {
              clientId = id;
              es.close(); // reopen with the id so reconnects stay on this client
              open("/events?client=" + encodeURIComponent(id));
              for (const m of outbox.splice(0)) post(m); // flush queued commands
            }
          });
          es.onmessage = (e) => window.dispatchEvent(new MessageEvent("message", { data: JSON.parse(e.data) }));
        }
        open("/events");
        return {
          postMessage: (obj) => {
            const s = JSON.stringify(obj);
            if (clientId !== null) post(s); else outbox.push(s);
          },
        };
      })();

  // ---- markdown rendering (marked + dompurify), with a plain-text fallback ----
  const MD_OK = !!(window.marked && window.DOMPurify);
  if (MD_OK) window.marked.setOptions({ breaks: true, gfm: true });
  // Render md text into el's innerHTML (sanitized). Falls back to textContent if the
  // libs didn't load. We keep the raw md on el.dataset.md so copy yields the source.
  function renderMd(el, text) {
    el.dataset.md = text;
    if (!MD_OK) { el.textContent = text; return; }
    try { el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text)); }
    catch (e) { el.textContent = text; }
  }

  const log = document.getElementById('log');
  const mainEl = document.getElementById('main');
  const loadingEl = document.getElementById('loading');
  // hide the IQ watermark once the chat has any content; show it on an empty log
  function syncWatermark() { mainEl.classList.toggle('hasMsgs', log.childElementCount > 0); }
  // loading veil while a session is carried to the other engine (cross-CLI switch)
  function showLoading() { loadingEl.style.display = 'flex'; }
  function hideLoading() { loadingEl.style.display = 'none'; }
  const input = document.getElementById('input');
  const sessList = document.getElementById('sessList');
  const showAll = document.getElementById('showAll');
  const emptyEl = document.getElementById('empty');
  const modelSel = document.getElementById('model');
  const composer = document.getElementById('composer');
  const autoEditChk = document.getElementById('autoEditChk');
  const approvalDock = document.getElementById('approvalDock');
  const tabs = Array.from(document.querySelectorAll('.etab'));

  let streaming = null;     // bubble currently being streamed into
  let allSessions = [];     // last sessions payload from extension
  let activeId = null;
  let expanded = false;     // "모두 보기" toggled?
  const COLLAPSED = 5;      // sessions shown before "모두 보기(N)"

  // Platform = which CLI. Model = the actual model inside it.
  // value 'default' = pass no --model (CLI's own default); label shows WHICH model
  // that currently is, so the user knows what 'default' resolves to. We're just a
  // wrapper — when a CLI ships a new default, only this label needs updating.
  const MODELS = {
    claude: [
      { value: 'default', label: 'default (Opus 4.8)' },
      { value: 'opus',    label: 'opus' },
      { value: 'sonnet',  label: 'sonnet' },
      { value: 'haiku',   label: 'haiku' },
    ],
    codex: [
      { value: 'default',      label: 'default (gpt-5-codex)' },
      { value: 'gpt-5',        label: 'gpt-5' },
      { value: 'gpt-5-codex',  label: 'gpt-5-codex' },
      { value: 'o3',           label: 'o3' },
    ],
  };
  let cli = 'claude';

  // ---- platform tabs + model dropdown ----
  function fillModels() {
    modelSel.innerHTML = '';
    for (const m of (MODELS[cli] || [{ value: 'default', label: 'default' }])) {
      const o = document.createElement('option');
      o.value = m.value; o.textContent = m.label;
      modelSel.appendChild(o);
    }
  }
  function setTab(next) {
    if (next !== 'claude' && next !== 'codex') return;
    cli = next;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.cli === cli));
    composer.dataset.cli = cli;                       // tints the input (claude=orange/codex=green)
    input.placeholder = 'Message ' + cli + '... (Enter to send)';
    fillModels();
  }
  function selectTab(next) {
    if (next === cli) return;
    setTab(next);
    vscode.postMessage({ type: 'platform', cli });
    vscode.postMessage({ type: 'model', model: modelSel.value });
  }
  tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.cli)));
  modelSel.addEventListener('change', () => vscode.postMessage({ type: 'model', model: modelSel.value }));
  fillModels();

  // ---- relative time ("3개월", "1일", "방금") ----
  function rel(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return '방금';
    const m = s / 60; if (m < 60) return Math.floor(m) + '분';
    const h = m / 60; if (h < 24) return Math.floor(h) + '시간';
    const d = h / 24; if (d < 30) return Math.floor(d) + '일';
    const mo = d / 30; if (mo < 12) return Math.floor(mo) + '개월';
    return Math.floor(mo / 12) + '년';
  }

  // ---- turn threads ----
  // The log is a list of TURNS. A user command opens a turn (sticky header +
  // timeline body); every reply until the next user command is a NODE on that
  // turn's body. tailTurn/headTurn track where new replies and prepended history go.
  let tailTurn = null; // the turn new (bottom) replies attach to
  let headTurn = null; // the turn prepended (top, older) replies attach to

  // Open a new turn at the bottom (a fresh user command). Returns its body element.
  function startTurn(userText, badgeCli) {
    const turn = document.createElement('div'); turn.className = 'turn';
    const head = document.createElement('div'); head.className = 'turnHead';
    head.innerHTML = '<span class="uq">&gt;</span>';
    const ut = document.createElement('div'); ut.className = 'utext'; ut.textContent = userText;
    head.appendChild(ut);
    if (badgeCli) { const b = document.createElement('span'); b.className = 'badge ' + badgeCli;
      b.textContent = badgeCli === 'codex' ? 'codex · gpt' : 'claude'; head.appendChild(b); }
    const body = document.createElement('div'); body.className = 'turnBody';
    turn.appendChild(head); turn.appendChild(body);
    log.appendChild(turn);
    turn._body = body; tailTurn = turn;
    log.scrollTop = log.scrollHeight;
    syncWatermark();
    return body;
  }
  // Open a turn at the TOP (prepended older history). Same shape, inserted first.
  function startTurnTop(userText, badgeCli) {
    const turn = document.createElement('div'); turn.className = 'turn';
    const head = document.createElement('div'); head.className = 'turnHead';
    head.innerHTML = '<span class="uq">&gt;</span>';
    const ut = document.createElement('div'); ut.className = 'utext'; ut.textContent = userText;
    head.appendChild(ut);
    if (badgeCli) { const b = document.createElement('span'); b.className = 'badge ' + badgeCli;
      b.textContent = badgeCli === 'codex' ? 'codex · gpt' : 'claude'; head.appendChild(b); }
    const body = document.createElement('div'); body.className = 'turnBody';
    turn.appendChild(head); turn.appendChild(body);
    log.insertBefore(turn, log.firstChild);
    turn._body = body; headTurn = turn;
    return body;
  }
  // The body a new BOTTOM reply attaches to. If no turn is open yet (a reply with no
  // preceding user command — e.g. a resumed assistant-first history), open a headless
  // turn so the timeline still renders.
  function tailBody() {
    if (tailTurn && tailTurn._body) return tailTurn._body;
    const turn = document.createElement('div'); turn.className = 'turn';
    const body = document.createElement('div'); body.className = 'turnBody';
    turn.appendChild(body); log.appendChild(turn); turn._body = body; tailTurn = turn;
    syncWatermark();
    return body;
  }

  // Add a reply NODE (assistant/thinking/tool/summary) to a turn body. dir: 'tail'
  // = current bottom turn; 'head' = the prepended top turn.
  function appendNode(el, dir) {
    const body = dir === 'head'
      ? (headTurn && headTurn._body) || startTurnTop('', undefined)
      : tailBody();
    body.appendChild(el);
    if (dir !== 'head') log.scrollTop = log.scrollHeight;
  }

  // ---- reply bubble (an assistant/thinking text node on the current turn) ----
  // prepend=true → goes on the prepended (older) head turn; else the bottom tail turn.
  function bubble(role, prepend, badgeCli) {
    const node = document.createElement('div');
    // the engine class (claude/codex) tints the timeline dot into an engine mark
    node.className = 'node ' + role + (badgeCli ? ' ' + badgeCli : '');
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    node.appendChild(el);
    // a hover copy button — copies THIS message's text (el is the live target, so it
    // reflects the final streamed text at click time)
    if (role === 'assistant' || role === 'thinking') addCopy(node, el);
    appendNode(node, prepend ? 'head' : 'tail');
    el._row = node; // node element, so callers can attach a footer / clamp toggle
    return el;
  }

  // SVG copy/check glyphs + the button that copies an element's text on click.
  const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 5"/></svg>';
  function addCopy(node, textEl) {
    const btn = document.createElement('button');
    btn.className = 'copyBtn'; btn.title = 'Copy'; btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = textEl.dataset.md || textEl.textContent || ''; // copy raw md source
      const done = () => { btn.classList.add('done'); btn.innerHTML = CHECK_ICON;
        setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = COPY_ICON; }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
      else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); done(); } catch (e2) {} document.body.removeChild(ta); }
    });
    node.appendChild(btn);
  }

  // Clamp a long body element behind a fade with a "show more / less" toggle.
  // Used for verbose user messages and folded summaries.
  function clampBody(el, row, threshold) {
    if ((el.textContent || '').length <= threshold) return;
    el.classList.add('clamp');
    const btn = document.createElement('button');
    btn.className = 'moreBtn'; btn.textContent = 'show more';
    btn.addEventListener('click', () => {
      const on = el.classList.toggle('clamp');
      btn.textContent = on ? 'show more' : 'show less';
    });
    row.appendChild(btn);
  }

  // A /compact boundary: an amber rule ("CONTEXT COMPACTED") plus the summary text
  // in a quiet, foldable side-barred block. role:"summary" records land here so the
  // user SEES where history was condensed instead of it reading as a normal turn.
  function renderSummary(text, prepend) {
    const node = document.createElement('div'); node.className = 'node summary';
    const rule = document.createElement('div');
    rule.className = 'compactRule';
    rule.innerHTML = '<div class="ln"></div><span class="lbl">⌘ context compacted</span><div class="ln"></div>';
    const body = document.createElement('div');
    body.className = 'summaryBody';
    body.textContent = text;
    node.appendChild(rule); node.appendChild(body);
    appendNode(node, prepend ? 'head' : 'tail');
    if (!prepend) clampBody(body, body, 400);
  }

  // The footer under an assistant reply: elapsed time + model name (when known).
  function addFooter(row, durationMs, model) {
    if (durationMs == null && !model) return;
    const f = document.createElement('div'); f.className = 'footer';
    if (durationMs != null) {
      const s = durationMs / 1000;
      f.appendChild(document.createTextNode(s < 60 ? s.toFixed(1) + 's' : Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's'));
    }
    if (model) { const m = document.createElement('span'); m.className = 'mdl'; m.textContent = model; f.appendChild(m); }
    row.appendChild(f);
  }
  // ---- tool / bash / diff cards ----
  // Tool actions render as compact cards (a bash run, a diff, a file op) instead
  // of plain text — the "what the agent actually did" view. claude sends the
  // command and its output as SEPARATE messages; we merge the output into the
  // open bash card so it reads like one block (codex already sends them together).
  let openBash = null; // a bash card awaiting its output (claude's split result)
  function toolRow(prepend) {
    const row = document.createElement('div');
    row.className = 'node tool';
    appendNode(row, prepend ? 'head' : 'tail');
    return row;
  }
  // a 11px chevron that rotates when its card is open
  const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
  // Make a head row toggle a body element (chevron rotates, body hides). The body
  // starts collapsed for bash output (noisy), open for diffs (the point of the card).
  function makeCollapsible(head, body, startOpen) {
    head.classList.add('clickable');
    head.insertAdjacentHTML('afterbegin', CHEV);
    const set = (open) => { head.classList.toggle('open', open); body.hidden = !open; };
    set(startOpen);
    head.addEventListener('click', () => set(body.hidden));
  }
  function setOutput(card, output, exitCode) {
    let out = card.querySelector('.toolOut');
    if (!out) {
      out = document.createElement('pre'); out.className = 'toolOut toolBody';
      card.appendChild(out);
      makeCollapsible(card.querySelector('.toolHead'), out, false); // bash output folds away
    }
    out.textContent = output;
    if (typeof exitCode === 'number' && exitCode !== 0) card.classList.add('failed');
  }
  // Render a diff into the 'pre' element, showing only ±CTX lines around each
  // change and folding long unchanged runs into a "⋯" marker (OpenGUI-style). The
  // +/- gutter is a fixed-width column so code lines align. Returns {added,removed}.
  function renderDiff(pre, diffText) {
    const lines = diffText.split('\\n');
    const kind = lines.map((l) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx'));
    let added = 0, removed = 0;
    for (const k of kind) { if (k === 'add') added++; else if (k === 'del') removed++; }
    const CTX = 2;
    const keep = new Array(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
      if (kind[i] === 'ctx') continue;
      for (let c = Math.max(0, i - CTX); c <= Math.min(lines.length - 1, i + CTX); c++) keep[c] = true;
    }
    let folding = false;
    for (let i = 0; i < lines.length; i++) {
      if (!keep[i]) {
        if (!folding) { folding = true; const f = document.createElement('div'); f.className = 'fold'; f.textContent = '⋯'; pre.appendChild(f); }
        continue;
      }
      folding = false;
      const d = document.createElement('div'); d.className = kind[i];
      const sign = kind[i] === 'add' ? '+' : kind[i] === 'del' ? '−' : '';
      const text = lines[i].replace(/^[+\\-]/, '');
      d.innerHTML = '<span class="gut">' + sign + '</span>';
      d.appendChild(document.createTextNode(text || '\\u00A0'));
      pre.appendChild(d);
    }
    return { added, removed };
  }
  // Build a tool card into the given .node.tool row. Shared by live render + history
  // prepend. Returns the bash card if it's awaiting output (so the caller can track it).
  function renderToolInto(row, msg) {
    const t = msg.tool || {};
    if (t.command !== undefined) {
      const card = document.createElement('div'); card.className = 'toolCard bash';
      const head = document.createElement('div'); head.className = 'toolHead';
      head.innerHTML = '<span class="tk">$</span>';
      const cmd = document.createElement('span'); cmd.className = 'cmd'; cmd.textContent = t.command;
      head.appendChild(cmd); card.appendChild(head);
      if (t.output) setOutput(card, t.output, t.exitCode);
      row.appendChild(card);
      return t.output ? null : card; // no output yet → caller may fold a later result in
    } else if (t.diff !== undefined) {
      const card = document.createElement('div'); card.className = 'toolCard diff';
      const head = document.createElement('div'); head.className = 'toolHead';
      head.innerHTML = '<span class="tk">✎</span>';
      const fn = document.createElement('span'); fn.className = 'file'; fn.textContent = t.file || 'edit';
      head.appendChild(fn);
      card.appendChild(head);
      const pre = document.createElement('pre'); pre.className = 'diffBody toolBody';
      const { added, removed } = renderDiff(pre, t.diff);
      const stat = document.createElement('span'); stat.className = 'stat';
      stat.innerHTML = '<span class="plus">+' + added + '</span><span class="minus">−' + removed + '</span>';
      head.appendChild(stat);
      card.appendChild(pre);
      makeCollapsible(head, pre, true);
      row.appendChild(card);
    } else {
      const card = document.createElement('div'); card.className = 'toolCard op';
      const icon = t.name === 'Read' ? '📖' : t.name === 'Write' ? '✎' : '•';
      card.innerHTML = '<span class="icon">' + icon + '</span>';
      card.appendChild(document.createTextNode(msg.text || t.name || 'tool'));
      row.appendChild(card);
    }
    return null;
  }
  function renderTool(msg, prepend) {
    const t = msg.tool || {};
    // output-only result (claude) → fold into the open bash card
    if (t.command === undefined && t.diff === undefined && t.output && openBash && !prepend) {
      setOutput(openBash, t.output, t.exitCode);
      openBash = null;
      return;
    }
    const row = toolRow(prepend);
    const awaiting = renderToolInto(row, msg);
    if (awaiting) openBash = awaiting; // bash card waiting for its result message
    if (!prepend) { if (typingEl) tailBody().appendChild(typingEl); log.scrollTop = log.scrollHeight; }
  }

  // ---- tool-approval card ----
  // When the engine needs a tool approved, render a green-accented card showing what
  // it wants to do (the command / file / diff) with [Approve] [Always] [Deny] buttons.
  // Clicking posts the decision back; the card then locks to show the resolution.
  function renderApproval(req) {
    // auto-edit: if the toggle is on and this is a file edit/write, approve it
    // silently (the tool card the engine emits already shows what changed).
    if (autoEditChk && autoEditChk.checked && (req.kind === 'edit' || req.kind === 'write')) {
      vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome: 'once' });
      return;
    }
    const card = document.createElement('div');
    card.className = 'approvalCard';

    const head = document.createElement('div'); head.className = 'apHead';
    head.innerHTML = '<span class="apk">' + (req.kind === 'bash' ? '$' : req.kind === 'read' ? '📖' : '✎') + '</span>';
    const ttl = document.createElement('span'); ttl.className = 'apTitle'; ttl.textContent = req.title || req.tool;
    head.appendChild(ttl);
    const tag = document.createElement('span'); tag.className = 'apTag'; tag.textContent = req.cli;
    head.appendChild(tag);
    card.appendChild(head);

    // detail: command for bash, diff for edit, file for read/write
    if (req.command) {
      const pre = document.createElement('pre'); pre.className = 'apBody'; pre.textContent = req.command;
      card.appendChild(pre);
    } else if (req.diff) {
      const pre = document.createElement('pre'); pre.className = 'apBody diffBody';
      for (const ln of String(req.diff).split('\\n')) {
        const d = document.createElement('div');
        d.className = ln[0] === '+' ? 'add' : ln[0] === '-' ? 'del' : 'ctx';
        d.textContent = ln; pre.appendChild(d);
      }
      card.appendChild(pre);
    } else if (req.file) {
      const f = document.createElement('div'); f.className = 'apBody'; f.textContent = req.file;
      card.appendChild(f);
    }

    const actions = document.createElement('div'); actions.className = 'apActions';
    const decide = (outcome) => {
      vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome });
      card.remove(); // answered → clear it from the dock
      syncComposerLock(); // unfreeze once the last pending approval is answered
    };
    const mk = (label, outcome, cls) => {
      const b = document.createElement('button'); b.className = 'apBtn ' + cls; b.textContent = label;
      b.addEventListener('click', () => decide(outcome)); return b;
    };
    const btns = [mk('Approve', 'once', 'ok'), mk('Always', 'always', 'always'), mk('Deny', 'deny', 'no')];
    for (const b of btns) actions.appendChild(b);
    card.appendChild(actions);

    // keyboard: ← → move focus between buttons, Enter/Space activates the focused one
    // (a native button does that for Enter/Space). Default focus = Approve, like claude.
    card.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowRight') { e.preventDefault(); btns[(Math.max(0, i) + 1) % btns.length].focus(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); btns[(Math.max(0, i) + btns.length - 1) % btns.length].focus(); }
    });

    // dock it just above the composer (newest on top), not inside the scrolling log
    approvalDock.insertBefore(card, approvalDock.firstChild);
    syncComposerLock(); // freeze the input while this (and any other) approval is open
    btns[0].focus(); // default focus on Approve so Enter approves right away
  }

  function onMessage(msg) {
    // a user command OPENS a new turn (its sticky header); everything after attaches
    // to that turn until the next user command.
    if (msg.role === 'user') {
      const body = startTurn(msg.text, undefined);
      if (typingEl) body.appendChild(typingEl);
      return;
    }
    if (msg.role === 'tool') { renderTool(msg, false); return; }
    if (msg.role === 'summary') { renderSummary(msg.text, false); return; }
    // Badge = the engine that ACTUALLY produced this message (msg.cli, stamped by
    // the runtime). NO fallback to the current tab — if a message has no cli (old
    // session saved before per-message cli), we show no badge rather than a wrong,
    // tab-following one. So badges never flip when you switch tabs.
    // assistant / thinking reply nodes (badge only on assistant). The turn was
    // already opened by the preceding user message.
    const badge = (msg.role === 'assistant' && msg.cli) ? msg.cli : undefined;
    // assistant text is markdown; user/thinking stay plain. While streaming we show
    // raw accumulating text (cheap), then render md once the turn's text is complete.
    const asMd = (el, raw) => { if (msg.role === 'assistant') renderMd(el, raw); else { el.textContent = raw; el.dataset.md = raw; } };
    if (msg.partial) {
      if (!streaming || streaming.dataset.role !== msg.role) {
        streaming = bubble(msg.role, false, badge);
        streaming.dataset.role = msg.role;
        streaming.dataset.acc = '';
        streaming.classList.add('cursor');
      }
      streaming.dataset.acc += msg.text;
      streaming.textContent = streaming.dataset.acc; // raw during stream
    } else {
      if (streaming && streaming.dataset.role === msg.role) {
        const raw = (streaming.dataset.acc || '') + msg.text;
        streaming.classList.remove('cursor');
        asMd(streaming, raw);
        streaming = null;
      } else {
        const el = bubble(msg.role, false, badge);
        asMd(el, msg.text);
        if (msg.role === 'assistant') addFooter(el._row, msg.durationMs, msg.model); // time + model
      }
    }
    if (typingEl) tailBody().appendChild(typingEl); // keep the indicator at the thread's tail
    log.scrollTop = log.scrollHeight;
  }

  // ---- session list (title + relative time + 모두 보기) ----
  function renderSessions() {
    sessList.innerHTML = '';
    emptyEl.style.display = allSessions.length ? 'none' : 'block';
    const shown = expanded ? allSessions : allSessions.slice(0, COLLAPSED);
    for (const s of shown) {
      const el = document.createElement('div');
      el.className = 'sess' + (s.sessionId === activeId ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = s.title || '(untitled)';
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = rel(s.ts);
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = '\\u2715'; // x mark
      del.title = 'Delete session';
      del.onclick = (e) => {
        e.stopPropagation(); // don't trigger the row's open
        vscode.postMessage({ type: 'delete', sessionId: s.sessionId });
      };
      el.appendChild(title); el.appendChild(time); el.appendChild(del);
      // cross-CLI: clicking opens the session in the CURRENT tab's cli, so we no
      // longer send the session's own cli (the extension ignores it).
      el.onclick = () => { vscode.postMessage({ type: 'open', sessionId: s.sessionId }); closeMenus(); };
      sessList.appendChild(el);
    }
    if (allSessions.length > COLLAPSED) {
      showAll.style.display = 'block';
      showAll.textContent = expanded ? '접기' : '모두 보기(' + allSessions.length + ')';
    } else {
      showAll.style.display = 'none';
    }
  }
  showAll.addEventListener('click', () => { expanded = !expanded; renderSessions(); });

  // ---- input ----
  // ---- typing indicator (shown while the engine works, until turn end) ----
  let typingEl = null;
  function showTyping() {
    if (typingEl) return;
    const node = document.createElement('div');
    node.className = 'node typing';
    node.innerHTML = '<div class="typing"><span class="who">' + cli
      + '</span><span class="dots"><i></i><i></i><i></i></span></div>';
    tailBody().appendChild(node);
    log.scrollTop = log.scrollHeight;
    typingEl = node;
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  // While a tool approval is pending, freeze the composer: the user must answer the
  // approval before sending more. We DON'T clear what they've typed — input.value is
  // left intact, just disabled — so a half-written message survives the wait. Called
  // whenever the approval dock gains/loses a card. The send button mirrors the lock.
  const sendBtn = document.getElementById('send');
  function syncComposerLock() {
    const locked = approvalDock.childElementCount > 0;
    input.disabled = locked;
    if (sendBtn) sendBtn.disabled = locked;
    composer.classList.toggle('locked', locked);
    input.placeholder = locked
      ? 'Answer the approval above to continue…'
      : 'Message ' + (composer.dataset.cli || 'claude') + '... (Enter to send)';
  }

  function send() {
    if (input.disabled) return;       // frozen while an approval is pending
    const text = input.value.trim();
    if (!text) return;
    // local slash commands handled in the webview (not sent to the agent).
    // /mockupskills [name ...]  → demo the "Casting" UI with the given skills (none = idle).
    if (text === '/mockupskills' || text.startsWith('/mockupskills ')) {
      const names = text.slice('/mockupskills'.length).trim().split(/\\s+/).filter(Boolean);
      setSkills(names);
      if (skillsPanel.style.display === 'none') { skillsPanel.style.display = 'block'; skillsBtn.classList.add('on'); }
      input.value = '';
      return;
    }
    // /mockskill <name>  → demo the skill marquee (green glowing "Casting <name>")
    if (text === '/mockskill' || text.startsWith('/mockskill ')) {
      flashSkill(text.slice('/mockskill'.length).trim() || 'cleancode');
      input.value = '';
      return;
    }
    vscode.postMessage({ type: 'send', text });
    input.value = '';
    showTyping();
  }
  document.getElementById('send').addEventListener('click', send);
  document.getElementById('newBtn').addEventListener('click', () => { vscode.postMessage({ type: 'new' }); closeMenus(); });
  document.getElementById('newTabBtn').addEventListener('click', () => vscode.postMessage({ type: 'newTab' }));
  input.addEventListener('keydown', (e) => {
    // e.isComposing = IME (Korean/Japanese/Chinese) mid-composition; don't send
    // a half-formed syllable. keyCode 229 is the legacy IME-in-progress signal.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---- storage pill (Local always on; Cloud optional mirror) ----
  const cloudState = document.getElementById('cloudState');
  const cloudBtn = document.getElementById('cloudBtn');
  let storageOptions = [];
  let cloudConnected = false;

  function renderStorage(info, options) {
    storageOptions = options || storageOptions;
    cloudConnected = !!(info && info.connected);
    if (cloudConnected) {
      const label = (info.kind === 'gdrive' ? 'Google Drive'
                  : info.kind === 'icloud' ? 'iCloud'
                  : info.kind === 'custom' ? 'Cloud' : info.kind);
      // label links to the provider (gdrive opens drive.google.com); account
      // (the signed-in email) shows in muted text after it.
      const linkable = info.kind === 'gdrive';
      const acct = info.account ? ' <span class="acct">(' + info.account + ')</span>' : '';
      cloudState.innerHTML = '<span class="dot cloud-on">●</span>'
        + (linkable ? '<a href="#" id="cloudLink" class="link">' + label + '</a>' : label)
        + acct;
      const link = document.getElementById('cloudLink');
      if (link) link.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'openCloud', kind: info.kind });
      });
      cloudBtn.textContent = 'disconnect';
    } else {
      cloudState.innerHTML = '<span class="dot cloud-off">●</span>No cloud';
      cloudBtn.textContent = 'connect';
    }
  }

  // connect = pick from a tiny prompt list; disconnect = turn the mirror off.
  cloudBtn.addEventListener('click', () => {
    if (cloudConnected) { vscode.postMessage({ type: 'disconnectCloud' }); return; }
    vscode.postMessage({ type: 'pickCloud' }); // extension shows a native quick-pick
  });

  // ---- view switcher: Chat <-> My Wallet (full page) ----
  const panels = {
    chat: document.getElementById('chatView'),
    wallet: document.getElementById('walletView'),
  };
  function showView(name) {
    for (const k in panels) panels[k].style.display = (k === name) ? 'flex' : 'none';
    if (name === 'wallet') vscode.postMessage({ type: 'wallet' }); // refresh address
  }
  document.getElementById('backToChat').addEventListener('click', () => showView('chat'));

  // ---- top-bar dropdowns: History (sessions) + Wallet (agent menu) ----
  const histMenu = document.getElementById('histMenu');
  const walletMenu = document.getElementById('walletMenu');
  function closeMenus(except) {
    if (except !== 'hist') histMenu.style.display = 'none';
    if (except !== 'wallet') walletMenu.style.display = 'none';
  }
  function toggleMenu(el, which) {
    const open = el.style.display !== 'none';
    closeMenus(open ? null : which);
    el.style.display = open ? 'none' : 'block';
  }
  document.getElementById('histBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(histMenu, 'hist'); });
  document.getElementById('walletPill').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(walletMenu, 'wallet'); });
  document.getElementById('openWalletPage').addEventListener('click', () => { closeMenus(); showView('wallet'); });
  // click outside closes any open menu
  document.addEventListener('click', () => closeMenus());
  histMenu.addEventListener('click', (e) => e.stopPropagation());
  walletMenu.addEventListener('click', (e) => e.stopPropagation());

  // equipped-skills panel: inline toggle above the composer (not an absolute dropdown)
  const skillsBtn = document.getElementById('skillsBtn');
  const skillsPanel = document.getElementById('skillsPanel');
  skillsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = skillsPanel.style.display !== 'none';
    skillsPanel.style.display = open ? 'none' : 'block';
    skillsBtn.classList.toggle('on', !open);
  });
  // The agent's OWNED skills (array of names) — everything owned is "active" (no
  // separate active state). Renders each as an item card in the panel; empty slots
  // fill the rest. No count badge (ownership is the whole point, not a number).
  function setSkills(names) {
    names = names || [];
    const grid = document.getElementById('skillGrid');
    const status = document.getElementById('skillStatus');
    const n = names.length;
    document.getElementById('skillsPanel').classList.toggle('casting', n > 0);
    document.getElementById('skillsBtn').classList.toggle('casting', n > 0);
    status.textContent = n ? (n === 1 ? '1 skill' : n + ' skills') : 'none yet';
    grid.innerHTML = '';
    for (const name of names) {
      const slot = document.createElement('div'); slot.className = 'skSlot item';
      slot.innerHTML = '<span class="skWand">' + ${JSON.stringify(WAND_SVG)} + '</span>';
      const lbl = document.createElement('div'); lbl.className = 'skName'; lbl.textContent = name;
      slot.appendChild(lbl); slot.title = name; grid.appendChild(slot);
    }
    const fill = Math.max(0, 3 - n);
    for (let i = 0; i < fill; i++) { const s = document.createElement('div'); s.className = 'skSlot empty'; grid.appendChild(s); }
    ownedSkills = names;
  }
  let ownedSkills = [];
  setSkills([]); // idle: grey coming-soon slots

  // ---- marketplace: search → buy → install (host does the chain work) ----
  const skillSearch = document.getElementById('skillSearch');
  const skillResults = document.getElementById('skillResults');
  function runSkillSearch() {
    const q = skillSearch.value.trim();
    skillResults.innerHTML = '<div class="shopEmpty">Searching…</div>';
    vscode.postMessage({ type: 'searchSkills', query: q });
  }
  document.getElementById('skillSearchBtn').addEventListener('click', runSkillSearch);
  skillSearch.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); runSkillSearch(); }
  });
  function renderSkillResults(results) {
    results = results || [];
    skillResults.innerHTML = '';
    if (!results.length) { skillResults.innerHTML = '<div class="shopEmpty">No skills found.</div>'; return; }
    for (const r of results) {
      const owned = ownedSkills.indexOf(r.name) >= 0;
      const item = document.createElement('div'); item.className = 'shopItem';
      const main = document.createElement('div'); main.className = 'si-main';
      const nm = document.createElement('div'); nm.className = 'si-name'; nm.textContent = r.name || r.id;
      const ds = document.createElement('div'); ds.className = 'si-desc'; ds.textContent = r.description || '';
      main.appendChild(nm); main.appendChild(ds);
      const sup = document.createElement('span'); sup.className = 'si-sup';
      sup.textContent = (typeof r.supply === 'number') ? (r.supply + '\\u00d7') : '';
      const buy = document.createElement('button'); buy.className = 'si-buy';
      buy.textContent = owned ? 'Owned' : 'Buy'; buy.disabled = owned;
      buy.addEventListener('click', () => {
        buy.disabled = true; buy.textContent = 'Buying…';
        vscode.postMessage({ type: 'buySkill', skillId: r.id, creatorWallet: r.creator });
      });
      item.appendChild(main); item.appendChild(sup); item.appendChild(buy);
      skillResults.appendChild(item);
    }
  }
  vscode.postMessage({ type: 'ownedSkills' }); // hydrate the panel on load

  // ---- passive skill-shopping toggle (issue #21) ----
  const shopToggle = document.getElementById('shopToggle');
  function setShopToggle(on) {
    shopToggle.classList.toggle('on', !!on);
    shopToggle.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  shopToggle.addEventListener('click', () => {
    const next = !shopToggle.classList.contains('on');
    setShopToggle(next); // optimistic; the host echoes the persisted value back
    vscode.postMessage({ type: 'setSkillShopping', on: next });
  });
  vscode.postMessage({ type: 'getSkillShopping' }); // hydrate the switch on load

  // ---- activity marquee: advertise what the agent is doing RIGHT NOW ----
  // Map a tool action to a flashy game-verb + object. The verb is picked from a small
  // pool (varied per call so it feels alive); the object is the skill name.
  const activityBar = document.getElementById('activityBar');
  const activityText = document.getElementById('activityText');
  const VERBS = { skill: ['Casting', 'Channeling', 'Wielding', 'Invoking'] };
  let pick = 0; // rotate so the verb feels alive
  let actTimer = null;
  // SKILL-ONLY marquee: only an equipped skill firing lights this up (a green, glowing
  // "Casting <skill>"). Plain tool work (read/bash/edit) is NOT shown here — it already
  // appears as cards in the chat timeline, so duplicating it would just be noise.
  function flashSkill(name) {
    const v = VERBS.skill[(pick++) % VERBS.skill.length];
    activityText.innerHTML = '<span class="verb">' + v + '</span> '
      + (name ? '<span class="obj">' + escapeHtml(name) + '</span>' : '');
    activityBar.classList.remove('out');
    activityBar.style.display = 'flex';
    clearTimeout(actTimer);
    const dwell = Math.min(4000, 1600 + (name || '').length * 35);
    actTimer = setTimeout(() => {
      activityBar.classList.add('out');
      setTimeout(() => { activityBar.style.display = 'none'; activityBar.classList.remove('out'); }, 250);
    }, dwell);
  }
  function hideActivity() { clearTimeout(actTimer); activityBar.classList.remove('out'); activityBar.style.display = 'none'; }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Fill the wallet pill, the wallet dropdown, and the full wallet page from one address.
  function short(a) { return a && a.length > 10 ? a.slice(0, 4) + '..' + a.slice(-3) : a; }
  function setWallet(address) {
    const full = address || '(not connected)';
    document.getElementById('walletAddr').textContent = full;
    document.getElementById('wAddr').textContent = address ? short(address) : 'not connected';
    const label = address ? short(address) : 'My Wallet';
    document.getElementById('wName').textContent = label;
    document.getElementById('wName2').textContent = address ? 'My Wallet' : 'My Wallet';
    // wallet-seeded character avatar (ported from solchat); same address = same face
    const svg = address ? avatarSvg(address) : '';
    document.getElementById('wAvatar').innerHTML = svg;
    document.getElementById('wAvatar2').innerHTML = svg;
    document.getElementById('wAvatarBig').innerHTML = svg;
  }

  // Drive sync indicator next to the pill: ✓ synced / ⚠ failed (hover = why).
  function renderCloudSync(status) {
    const el = document.getElementById('cloudSync');
    if (!el) return;
    if (!status || !cloudConnected) { el.textContent = ''; el.className = ''; el.title = ''; return; }
    if (status.ok) { el.textContent = '✓'; el.className = 'ok'; el.title = 'Synced to Drive'; }
    else { el.textContent = '⚠'; el.className = 'err'; el.title = 'Drive sync failed: ' + (status.error || 'unknown'); }
  }

  // My Wallet: storage summary mirrors the pill; address comes from the extension.
  function renderWalletStorage() {
    const el = document.getElementById('walletStorage');
    el.textContent = cloudConnected ? 'Local + cloud mirror (connected)' : 'Local only (no cloud)';
  }
  document.getElementById('disconnectWalletBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'disconnectWallet' });
  });

  // ---- scroll-to-top → load older page ----
  let pageCursor = null;   // cursor for the NEXT older page (null = none / at start)
  let hasMore = false;     // older pages exist?
  let loadingOlder = false;
  function resetPaging() { pageCursor = null; hasMore = false; loadingOlder = false; }

  // Prepend older messages while keeping the viewport pinned (no jump): measure
  // scroll height before/after and restore the offset.
  // Prepend an OLDER page (scroll-up). We build the page's turns into a detached
  // fragment IN ORDER (so user commands open turns correctly), then insert the whole
  // fragment above the current content — keeping scroll position stable.
  function prependOlder(messages) {
    const before = log.scrollHeight;
    const realLog = log;
    const frag = document.createElement('div');
    let body = null; // current turn body within the fragment
    const openTurn = (userText, badge) => {
      const turn = document.createElement('div'); turn.className = 'turn';
      const head = document.createElement('div'); head.className = 'turnHead';
      head.innerHTML = '<span class="uq">&gt;</span>';
      const ut = document.createElement('div'); ut.className = 'utext'; ut.textContent = userText;
      head.appendChild(ut);
      if (badge) { const b = document.createElement('span'); b.className = 'badge ' + badge;
        b.textContent = badge === 'codex' ? 'codex · gpt' : 'claude'; head.appendChild(b); }
      const b = document.createElement('div'); b.className = 'turnBody';
      turn.appendChild(head); turn.appendChild(b); frag.appendChild(turn); return b;
    };
    const node = (cls) => { const n = document.createElement('div'); n.className = 'node ' + cls;
      (body || (body = openTurn('', undefined))).appendChild(n); return n; };
    for (const m of messages) {
      if (m.role === 'user') { body = openTurn(m.text, undefined); continue; }
      if (m.role === 'tool') { renderToolInto(node('tool'), m); continue; }
      if (m.role === 'summary') {
        const n = node('summary');
        n.innerHTML = '<div class="compactRule"><div class="ln"></div><span class="lbl">⌘ context compacted</span><div class="ln"></div></div>';
        const sb = document.createElement('div'); sb.className = 'summaryBody'; sb.textContent = m.text; n.appendChild(sb);
        continue;
      }
      const n = node(m.role + (m.role === 'assistant' && m.cli ? ' ' + m.cli : ''));
      const el = document.createElement('div'); el.className = 'msg ' + m.role;
      if (m.role === 'assistant') renderMd(el, m.text); else { el.textContent = m.text; el.dataset.md = m.text; }
      n.appendChild(el);
      if (m.role === 'assistant' || m.role === 'thinking') addCopy(n, el);
      if (m.role === 'assistant') addFooter(n, m.durationMs, m.model);
    }
    realLog.insertBefore(frag, realLog.firstChild);
    realLog.scrollTop += realLog.scrollHeight - before;
  }

  log.addEventListener('scroll', () => {
    if (log.scrollTop <= 8 && hasMore && !loadingOlder && pageCursor !== null) {
      loadingOlder = true;
      vscode.postMessage({ type: 'loadMore', cursor: pageCursor });
    }
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.type === 'message') onMessage(m.msg);
    else if (m.type === 'sessions') { allSessions = m.list || []; activeId = m.activeId; renderSessions(); }
    else if (m.type === 'loading') showLoading();
    else if (m.type === 'clear') { log.innerHTML = ''; approvalDock.innerHTML = ''; syncComposerLock(); streaming = null; openBash = null; tailTurn = null; headTurn = null; hideTyping(); hideActivity(); resetPaging(); syncWatermark(); hideLoading(); }
    else if (m.type === 'turnEnd') { hideTyping(); hideActivity(); }
    else if (m.type === 'skillActive') flashSkill(m.name); // a real skill fired (was /mockskill)
    else if (m.type === 'searchResults') renderSkillResults(m.results);
    else if (m.type === 'ownedSkills') setSkills(m.names || []);
    else if (m.type === 'skillShopping') setShopToggle(m.on);
    else if (m.type === 'buyResult') {
      if (m.ok) { runSkillSearch(); } // refresh the list so the bought item shows "Owned"
      else { skillResults.innerHTML = '<div class="shopEmpty">Buy failed: ' + escapeHtml(m.error || 'unknown') + '</div>'; }
    }
    else if (m.type === 'platform') setTab(m.cli); // extension switched CLI (e.g. on session open)
    else if (m.type === 'storage') { renderStorage(m.info, m.options); renderWalletStorage(); }
    else if (m.type === 'cloudSync') renderCloudSync(m.status);
    else if (m.type === 'wallet') setWallet(m.address);
    else if (m.type === 'page') { hasMore = m.hasMore; pageCursor = m.cursor; }
    else if (m.type === 'older') {
      prependOlder(m.messages || []);
      hasMore = m.hasMore; pageCursor = m.cursor; loadingOlder = false;
    }
    else if (m.type === 'approval') renderApproval(m.req);
  });

  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'wallet' }); // fill the bottom-left wallet card on load
</script>
</body>
</html>`;
}
