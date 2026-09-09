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
//
// The panel script itself lives in ./panel/ (real ES modules, typechecked with the DOM lib) and is
// inlined here from panel.generated.ts, a committed build artifact: run pnpm build:panel after
// editing anything under panel/ and commit the result, exactly like mdLibs.generated.ts.

import { IQ_LOGO_SVG } from "./iqlogo.js";
import { MD_LIBS } from "./mdLibs.generated.js";
import { WAND_SVG, PAPERCLIP_SVG, LAYERS_SVG } from "./icons.js";
import { PANEL_SCRIPT } from "./panel.generated.js";

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

export function chatHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- Doto: dot-matrix face for the COMPLETE plaque. Progressive enhancement — if the
     network/CSP blocks it, the plaque falls back to a bold monospace and the radial-dot
     texture still reads as an LED sign. -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Doto:wght@700;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
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
    --an-violet:      #a98bff;         /* skill-forge (publish) accent */
    --an-violet-soft: rgba(169,139,255,0.16);
    --an-violet-line: rgba(169,139,255,0.42);
    --an-violet-dim:  rgba(169,139,255,0.10);
    /* surface ramp — subtle, sits on top of the editor bg */
    --an-bg-1: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    --an-bg-2: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --an-line: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    --an-line-soft: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    /* corner-tick brackets for the terminal button treatment (SYSTEM // COMMON BUTTON),
       shared as a variable so every restyled button draws the same 8 corner marks. */
    --an-ticks:
      linear-gradient(#6e6e72,#6e6e72) left top / 7px 1.5px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) left top / 1.5px 7px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) right top / 7px 1.5px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) right top / 1.5px 7px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) left bottom / 7px 1.5px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) left bottom / 1.5px 7px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) right bottom / 7px 1.5px no-repeat,
      linear-gradient(#6e6e72,#6e6e72) right bottom / 1.5px 7px no-repeat;
    /* collectible tier ramp (verified-work stars) — agent directory + profile, issue #35.
       Literal rarity hues (a sanctioned multi-hue exception to the green brand accent). */
    --an-tier-bronze: #cd7f32;
    --an-tier-silver: #c0c0c0;
    --an-tier-gold: #ffd700;
    --an-tier-legendary: #c084fc;
    /* foreground ramp for the ported mobile cards (.an-id / .an-tfolder) */
    --an-fg: var(--vscode-foreground);
    --an-fg-mute: color-mix(in srgb, var(--vscode-foreground) 45%, transparent);
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
  /* Markets + AgentNet: sibling green-tinted pills next to the wallet — the two view entries */
  #marketsBtn, #agentsBtn { margin-left: 8px; background: var(--an-green-dim); color: var(--an-green);
                border: 1px solid var(--an-green-line); border-radius: 999px; padding: 3px 14px;
                font-size: 0.78em; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  #marketsBtn:hover, #agentsBtn:hover { background: color-mix(in srgb, var(--an-green) 22%, transparent); }
  #marketsBtn.on, #agentsBtn.on { background: var(--an-green); color: #07140d; }
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
  /* RPC row (issue #23): a green key box when set, a warn link when not, + net badge */
  .rpcKeyBox { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px;
               background: var(--an-green-dim); border: 1px solid var(--an-green-line); color: var(--an-green);
               font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
  .rpcWarn { color: #e0a030; cursor: pointer; font-weight: 600; }
  .rpcWarn:hover { text-decoration: underline; }
  .netBadge { padding: 1px 7px; border-radius: 999px; font-size: 0.66em; font-weight: 700; letter-spacing: 0.04em;
              text-transform: uppercase; }
  .netBadge.devnet { background: color-mix(in srgb, #e0a030 22%, transparent); color: #e0a030; }
  .netBadge.mainnet { background: var(--an-green-dim); color: var(--an-green); }
  .wmStorage .link { background: none; border: none; padding: 0 2px; width: auto;
                     color: var(--an-green); cursor: pointer; font-size: 1em; }
  .wmStorage .link:hover { text-decoration: underline; }
  #cloudSync { font-size: 0.92em; }
  #cloudSync.ok { color: var(--an-green); }
  #cloudSync.err { color: var(--vscode-errorForeground, #e55); cursor: help; }

  #wrap { flex: 1; display: flex; min-height: 0; }

  /* ── top-bar buttons (wallet pill, history, new tab) ─────────────────────── */
  #tabs .spacer { flex: 1; }
  /* One fixed height for EVERY top-bar button (wallet pill, Markets, Agents, history,
     new-tab) so they line up. border-box makes height the total; vertical centering does
     the rest, so per-button padding only sets width. */
  #tabs button { box-sizing: border-box; height: 26px; display: inline-flex; align-items: center;
                 gap: 6px; background: transparent; color: var(--vscode-foreground);
                 border: 1px solid var(--an-line); border-radius: 999px; padding: 0 11px;
                 font-size: 0.8em; cursor: pointer; opacity: 0.8; transition: all 0.12s; }
  #tabs button:hover { opacity: 1; border-color: var(--an-green-line); background: var(--an-bg-1); }
  #tabs .caret { opacity: 0.5; font-size: 0.8em; }
  #walletPill #wAvatar { width: 18px; height: 18px; border-radius: 50%; overflow: hidden;
                         background: var(--an-bg-2); flex: none; }
  #walletPill #wAvatar svg { display: block; width: 100%; height: 100%; }
  /* right-side utility buttons are icon-only, circular (History clock, new-tab +).
     Glyphs fill ~60% of the circle — smaller reads as a dot, not an icon. */
  #histBtn, #newTabBtn { width: 26px; height: 26px; padding: 0; justify-content: center; }
  #tabs button svg { width: 13px; height: 13px; display: block; flex: none; }

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
  /* caret sits at the right edge; when the count badge is shown it already grabs the
     space (margin-left:auto), so the caret just trails it with a small gap. */
  .wmItem .wmCaret { margin-left: auto; font-size: 0.7em; opacity: 0.5; transition: transform 0.12s; }
  .wmItem .soon:not([style*="none"]) + .wmCaret { margin-left: 6px; }
  .wmItem.open .wmCaret { transform: rotate(90deg); }
  .wmItem.wmDanger { color: var(--vscode-errorForeground, #f87171); }
  /* inline owned-skill list inside the wallet dropdown: scrollable, no buy/nav */
  #walletSkillList { max-height: 184px; overflow-y: auto; margin: 2px 4px 4px; padding: 2px;
                     display: flex; flex-direction: column; gap: 3px; }
  #walletSkillList .wskRow { display: flex; align-items: center; gap: 8px; padding: 7px 9px;
                     border-radius: var(--an-radius-sm); background: var(--an-bg-1);
                     border: 1px solid var(--an-green-line); font-size: 0.86em; }
  #walletSkillList .wskRow .wand { width: 13px; height: 13px; color: var(--an-green); flex: 0 0 auto; }
  #walletSkillList .wskEmpty { padding: 9px; font-size: 0.82em; opacity: 0.55; text-align: center; }

  /* right chat area */
  #main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
  #log { flex: 1; overflow-y: auto; padding: 0 0 24px; display: flex; flex-direction: column;
         scroll-behavior: smooth; position: relative; z-index: 1; overflow-anchor: auto; }

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

  /* wraps the scroller so the jump-to-latest button anchors to the log's bottom-right
     (above the composer), not to the whole right pane. */
  #logWrap { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
  /* round "jump to latest" button — hidden until the user scrolls up away from the newest
     message (see the stick-to-bottom logic in the script). */
  #jumpBtn { position: absolute; right: 14px; bottom: 14px; z-index: 6; padding: 0;
             width: 30px; height: 30px; border-radius: 999px; display: none;
             align-items: center; justify-content: center; cursor: pointer;
             color: color-mix(in srgb, var(--vscode-foreground) 72%, transparent);
             background: color-mix(in srgb, var(--an-bg-2) 82%, #000 18%);
             border: 1px solid rgba(255,255,255,0.14);
             box-shadow: 0 4px 12px rgba(0,0,0,0.18); opacity: 0.78;
             backdrop-filter: blur(8px);
             transition: opacity 0.12s, transform 0.12s, border-color 0.12s, color 0.12s,
                         background 0.12s, box-shadow 0.12s; }
  /* light theme: invert — white fill, dark outline */
  body.vscode-light #jumpBtn { color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
             background: color-mix(in srgb, var(--an-bg-2) 88%, #fff 12%);
             border-color: rgba(0,0,0,0.12); box-shadow: 0 4px 12px rgba(0,0,0,0.10); }
  /* engine accent for the unread state — keyed off data-cli, same source the send button uses */
  #jumpBtn[data-cli="claude"] { --eng: var(--claude); }
  #jumpBtn[data-cli="codex"]  { --eng: var(--an-green); }
  /* when there's a NEW message while scrolled up: outline + icon glow in the engine accent
     (claude=orange / codex=green), background stays black/white per theme. */
  #jumpBtn.hasNew { color: var(--eng); border-color: color-mix(in srgb, var(--eng) 88%, transparent);
                    background: color-mix(in srgb, var(--an-bg-2) 72%, transparent); opacity: 1;
                    box-shadow: 0 2px 12px color-mix(in srgb, var(--eng) 42%, transparent); }
  #jumpBtn svg { width: 14px; height: 14px; }
  #jumpBtn:hover { opacity: 0.96; transform: translateY(-1px);
                   border-color: color-mix(in srgb, currentColor 28%, transparent); }
  #jumpBtn.show { display: flex; }

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
  /* Solid background, NOT a backdrop-filter blur: every turn header is sticky, so a blur
     here spawns one compositing layer per turn and scroll cost grows with the chat length.
     An opaque fill pins just as cleanly (content still can't bleed through) for ~free. */
  .turnHead { position: sticky; top: 0; z-index: 5;
              background: var(--vscode-editor-background);
              border-bottom: 1px solid var(--an-line-soft);
              padding: 11px 16px; display: flex; align-items: flex-start; gap: 9px; cursor: default; }
  .turnHead .uq { color: var(--an-green); font-weight: 700; flex: none; line-height: 1.5; opacity: 0.8; }
  .turnHead .utext { flex: 1; min-width: 0; white-space: pre-wrap; line-height: 1.5; font-size: 0.95em;
                     font-weight: 600; overflow-wrap: anywhere; }
  /* a long user message collapses to a few lines; "Show more" expands it (capped to
     ~40vh with an inner scroll so a huge paste never eats the whole screen). */
  .utextWrap { flex: 1; min-width: 0; }
  .utextWrap .utext { width: 100%; }
  .utextWrap.collapsed .utext { max-height: 4.5em; overflow: hidden; }
  .utextWrap.expanded .utext { max-height: 40vh; overflow-y: auto; }
  .utextToggle { margin-top: 4px; font-size: 0.8em; font-weight: 600; color: var(--an-green);
                 opacity: 0.85; cursor: pointer; user-select: none; display: inline-block; }
  .utextToggle:hover { opacity: 1; text-decoration: underline; }
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
  /* streaming block wrappers (renderMdStreaming): keep the same edge-margin trims */
  .msg > .mdChunk:first-child > :first-child { margin-top: 0; }
  .msg > .mdChunk:last-child > :last-child { margin-bottom: 0; }
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

  /* per-code-block copy button: anchored to the wrapper, so it stays put while wide
     code scrolls under it. Revealed by hovering that block alone. */
  .preWrap { position: relative; }
  .preCopy { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 0;
             display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
             background: var(--an-bg-2); border: 1px solid var(--an-line-soft); border-radius: 6px;
             color: var(--vscode-foreground); opacity: 0; transition: opacity 0.12s, color 0.12s; }
  .preWrap:hover .preCopy { opacity: 0.75; }
  .preCopy:hover { opacity: 1; color: var(--an-green); border-color: var(--an-green-line); }
  .preCopy svg { width: 13px; height: 13px; }
  .preCopy.done { color: var(--an-green); opacity: 1; }
  /* whole-message copy: pinned top-right of an assistant reply, shown on that row's
     hover. Copies the raw markdown source, so pasting elsewhere keeps the formatting.
     pointer-events gates the hidden state so the invisible button never eats clicks
     or text selection at the bubble's corner. */
  .msgCopy { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; padding: 0;
             display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
             background: var(--an-bg-2); border: 1px solid var(--an-line-soft); border-radius: 6px;
             color: var(--vscode-foreground); opacity: 0; pointer-events: none;
             transition: opacity 0.12s, color 0.12s; z-index: 2; }
  .node.assistant:hover > .msgCopy { opacity: 0.75; pointer-events: auto; }
  .node.assistant > .msgCopy:hover { opacity: 1; color: var(--an-green); border-color: var(--an-green-line); }
  .node.assistant > .msgCopy.done { opacity: 1; pointer-events: auto; color: var(--an-green); }
  .msgCopy svg { width: 13px; height: 13px; }
  /* inline code IS its own copy button: a floating control would displace or cover the
     words around it, so the span tints on hover and flashes green once the copy lands. */
  .msg code.inlineCopy { cursor: pointer; transition: color 0.12s, border-color 0.12s, background 0.12s; }
  .msg code.inlineCopy:hover { color: var(--an-green); border-color: var(--an-green-line); }
  .msg code.inlineCopy.done { color: var(--an-green); border-color: var(--an-green-line); background: var(--an-bg-2); }
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
  /* engine-update banner: a slim caution bar (amber left rule, the design's context-boundary
     accent) pinned above the composer. Not inside #log, so a repaint never clears it. */
  #engineBanner { margin: 6px 12px 0; padding: 8px 8px 8px 11px; display: flex; align-items: flex-start; gap: 10px;
    background: var(--an-bg-2); border: 1px solid var(--an-line); border-left: 2px solid var(--an-amber);
    border-radius: var(--an-radius-sm); font-size: 0.8em; }
  #engineBanner .eb-body { flex: 1; color: var(--an-fg-mute); line-height: 1.4; }
  #engineBanner .eb-actions { display: flex; gap: 6px; flex-shrink: 0; }
  #engineBanner .eb-btn { padding: 3px 10px; font-size: 0.95em; background: transparent;
    border: 1px solid var(--an-line); border-radius: var(--an-radius-sm); color: var(--an-green); cursor: pointer; }
  #engineBanner .eb-btn:hover { border-color: var(--an-green); background: color-mix(in srgb, var(--an-green) 10%, transparent); }
  #engineBanner .eb-close { flex-shrink: 0; background: transparent; border: none; color: var(--an-fg-mute);
    font-size: 1.15em; line-height: 1; cursor: pointer; padding: 0 2px; opacity: 0.7; }
  #engineBanner .eb-close:hover { opacity: 1; color: var(--an-fg); }

  /* tool-APPROVAL card: like a tool card but actionable — green ring + buttons. */
  .approvalCard { border: 1px solid var(--an-green-line); border-radius: var(--an-radius-sm);
                  background: var(--an-green-dim); overflow: hidden;
                  box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
  /* ── skill-forge: a restrained violet treatment ONLY on the publish_skill card.
     Same shape as the plain approval card (opaque dark interior, hairline border,
     soft shadow) — just tinted violet with a faint top wash + a few slow twinkles.
     Opaque interior is the point: the old version filled with a translucent bg over a
     rainbow border, so the gradient bled through and washed out the text. ── */
  .approvalCard.skillForge {
    position: relative;
    border: 1px solid var(--an-violet-line);
    background:
      linear-gradient(180deg, var(--an-violet-dim), transparent 64%),
      var(--vscode-editor-background, #15161c);
    box-shadow: 0 4px 18px rgba(0,0,0,0.30);
    animation: forgeGlow 4.5s ease-in-out infinite;
  }
  @keyframes forgeGlow {
    0%,100% { box-shadow: 0 4px 18px rgba(0,0,0,0.30), 0 0 0 1px var(--an-violet-soft); }
    50%     { box-shadow: 0 4px 22px rgba(0,0,0,0.30), 0 0 14px -4px var(--an-violet-line); }
  }
  /* keep card content above the twinkle layer */
  .approvalCard.skillForge > .apHead,
  .approvalCard.skillForge > .apBody,
  .approvalCard.skillForge > .apActions { position: relative; z-index: 2; }
  .approvalCard.skillForge .apk { color: var(--an-violet); }
  .approvalCard.skillForge .forgeBody { color: var(--vscode-foreground); }
  .approvalCard.skillForge .apBody,
  .approvalCard.skillForge .apActions { border-top-color: var(--an-violet-dim); }
  /* a few slow, low-key twinkles — a hint of sparkle, not a fountain */
  .forgeStars { position:absolute; inset:0; z-index:1; pointer-events:none; overflow:hidden; }
  .forgeStars .st { position:absolute; color: var(--an-violet); opacity:0;
                    animation-name: forgeTwinkle; animation-timing-function: ease-in-out;
                    animation-iteration-count: infinite; }
  @keyframes forgeTwinkle {
    0%,100% { transform: scale(0.6); opacity:0; }
    50%     { transform: scale(1);   opacity:0.55; }
  }
  /* gold variant of the forge, for the BUY approval — same shape, amber accent (collectible) */
  .approvalCard.skillForge.buyForge {
    border-color: color-mix(in srgb, var(--an-amber) 42%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--an-amber) 12%, transparent), transparent 64%),
      var(--vscode-editor-background, #15161c);
    animation: forgeGlowBuy 4.5s ease-in-out infinite;
  }
  @keyframes forgeGlowBuy {
    0%,100% { box-shadow: 0 4px 18px rgba(0,0,0,0.30), 0 0 0 1px color-mix(in srgb, var(--an-amber) 18%, transparent); }
    50%     { box-shadow: 0 4px 22px rgba(0,0,0,0.30), 0 0 14px -4px color-mix(in srgb, var(--an-amber) 42%, transparent); }
  }
  .approvalCard.skillForge.buyForge .apk { color: var(--an-amber); }
  .approvalCard.skillForge.buyForge .forgeStars .st { color: var(--an-amber); }
  .approvalCard.skillForge.buyForge .apBody,
  .approvalCard.skillForge.buyForge .apActions { border-top-color: color-mix(in srgb, var(--an-amber) 22%, transparent); }
  @media (prefers-reduced-motion: reduce) {
    .approvalCard.skillForge { animation: none; }
    .forgeStars { display:none; }
  }
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
  /* AskUserQuestion card: one block per question, options as selectable chips plus an
     optional free-text field. The user's answer becomes the tool result, so there is no
     Approve/Deny — just answering and sending. */
  .qBlock { padding: 9px 12px; border-top: 1px solid var(--an-green-dim); }
  .qBlock:first-child { border-top: none; }
  .qCount { padding: 7px 12px 0; font-size: 0.72em; font-weight: 600; letter-spacing: 0.04em;
            color: var(--an-green); opacity: 0.8; }
  .qCount + .qBlock { border-top: none; }
  .qHeader { display: inline-block; font-size: 0.7em; font-weight: 600; text-transform: uppercase;
             letter-spacing: 0.04em; color: var(--an-green); background: var(--an-green-dim);
             padding: 1px 6px; border-radius: 4px; margin-bottom: 5px; }
  .qText { font-size: 0.88em; font-weight: 600; margin-bottom: 7px; }
  .qOpts { display: flex; flex-direction: column; gap: 6px; }
  .qOpt { text-align: left; padding: 7px 10px; border-radius: 8px; cursor: pointer;
          border: 1px solid var(--an-line); background: transparent; transition: border-color 0.12s, background 0.12s; }
  .qOpt:hover { border-color: var(--an-green-line); }
  .qOpt.on { border-color: var(--an-green); background: var(--an-green-dim); }
  .qOptLabel { font-size: 0.85em; font-weight: 600; }
  .qOptDesc { font-size: 0.78em; opacity: 0.7; margin-top: 2px; line-height: 1.35; }
  .qOtherLabel { margin-top: 8px; font-size: 0.76em; opacity: 0.72; }
  .qOtherInput { width: 100%; margin-top: 6px; border-radius: 8px; border: 1px solid var(--an-line);
                 background: var(--an-bg-1); color: var(--vscode-foreground); padding: 8px 10px;
                 font: inherit; resize: vertical; box-sizing: border-box; }
  .qOtherInput:focus { outline: none; border-color: var(--an-green); }
  .apBtn.ok:disabled { opacity: 0.4; cursor: not-allowed; filter: none; }
  /* minimal circular icon-only edit toggle (outline only, no fill) */
  .apEdit { margin-left: auto; flex: none; width: 24px; height: 24px; padding: 0;
            display: inline-flex; align-items: center; justify-content: center;
            border-radius: 50%; background: transparent; border: 1px solid var(--an-green-line);
            color: var(--an-green); opacity: 0.6; cursor: pointer; transition: opacity .12s, border-color .12s; }
  .apEdit:hover { opacity: 1; border-color: var(--an-green); }
  .apEdit:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--vscode-editor-background), 0 0 0 3px var(--an-green); }
  /* plan card body: wrap prose (not break-all like a path/command) */
  .apBody.planBody { word-break: normal; overflow-wrap: anywhere; }
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

  /* equipped-skills panel (above the composer). container-type lets the footer switch
     between a stacked (narrow dock) and single-row (wide panel) layout by panel width. */
  #skillsPanel { margin: 8px 12px 0; border: 1px solid var(--an-line); border-radius: var(--an-radius);
                 background: var(--vscode-editorWidget-background, var(--an-bg-2)); padding: 10px 12px;
                 container-type: inline-size; }
  #skillsPanel .skHead { display: flex; align-items: center; gap: 8px; font-size: 0.78em;
                         font-weight: 600; opacity: 0.85; margin-bottom: 9px;
                         font-family: var(--an-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
  #skillsPanel .skTitle { font-weight: 700; letter-spacing: 1.4px; }
  /* count chip next to the title (the 2a header); × is what gets pushed right */
  #skillsPanel .skMuted { font-weight: 400; opacity: 0.6; font-size: 0.9em;
                          border: 1px solid var(--an-line); padding: 1px 5px; border-radius: 2px; }
  #skillsClose { margin-left: auto; width: 20px; height: 20px; padding: 0; line-height: 18px; text-align: center;
                 font-size: 15px; border-radius: 5px; background: transparent; color: var(--vscode-foreground);
                 opacity: 0.55; border: 1px solid transparent; cursor: pointer; flex: 0 0 auto; }
  #skillsClose:hover { opacity: 1; background: var(--an-bg-1); border-color: var(--an-line); }
  /* owned-skill grid scrolls once it outgrows ~3 rows instead of pushing the chat up */
  /* responsive: 3 cols in a narrow dock, more as the panel widens (auto-fill packs
     as many ~80px cards as fit). max-height keeps it to ~3 rows then scrolls. */
  #skillGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 7px;
               max-height: 300px; overflow-y: auto; padding-right: 2px; }
  /* a skill slot: an item card. empty = a quiet dashed "coming soon" placeholder. */
  .skSlot { aspect-ratio: 1; border-radius: var(--an-radius-sm); display: flex; align-items: center;
            justify-content: center; }
  .skSlot.empty { aspect-ratio: 108 / 150; border: 1.5px dashed var(--an-line-soft); background: var(--an-bg-1); opacity: 0.5;
                  border-radius: 11px; }
  .skSlot.empty::after { content: ''; width: 16px; height: 16px; border-radius: 4px;
                         background: var(--an-line-soft); }
  /* an OWNED skill = a live item card: green-edged, but STATIC. It only glows while the
     skill is actually firing (.firing, toggled by flashSkill), not just because it's owned. */
  .skSlot.item { flex-direction: column; gap: 5px; padding: 8px 6px; aspect-ratio: auto;
                 border: 1px solid var(--an-green-line); background: var(--an-green-dim);
                 color: var(--an-green); position: relative; overflow: hidden; }
  /* un-pinned (disposed) skill — kept in the panel but greyed + desaturated; click re-equips */
  .skSlot.item.disabled { border-color: var(--an-line); background: var(--an-bg-1);
                          color: var(--vscode-descriptionForeground, #999); filter: grayscale(1); opacity: 0.5; }
  .skSlot.item.disabled:hover { opacity: 0.75; }
  .skSlot.item .skWand { width: 18px; height: 18px; display: inline-flex; }
  .skSlot.item .skName { font-size: 0.72em; color: var(--vscode-foreground); opacity: 0.92;
                         text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                         max-width: 100%; }
  /* the glow — on only while THIS skill is being used (a quicker pulse than a breath) */
  .skSlot.item.firing { animation: skBreath 1.4s ease-in-out infinite; }
  .skSlot.item.firing .skWand { filter: drop-shadow(0 0 5px var(--an-green)); }
  @keyframes skBreath {
    0%, 100% { box-shadow: 0 0 0 0 transparent; border-color: var(--an-green-line); }
    50%      { box-shadow: 0 0 12px -1px var(--an-green); border-color: var(--an-green); }
  }
  /* header "Casting: …" glows softly when something is active */
  #skillsPanel.casting .skMuted { color: var(--an-green); opacity: 0.95; font-weight: 600;
                                  text-shadow: 0 0 8px color-mix(in srgb, var(--an-green) 55%, transparent); }
  /* the skills BUTTON also hints when casting (badge already shows the count) */
  #skillsBtn.casting { color: var(--an-green); }
  .skNote { margin-top: 10px; font-size: 0.76em; opacity: 0.5; line-height: 1.5; }

  /* panel footer: publish + shop actions, and the passive skill-shopping toggle (issue #21).
     The in-panel marketplace search was removed — the SHOP button hands off to the full
     Markets view (which already does search/buy) instead of duplicating it in a small box. */
  .skDivider { height: 1px; background: var(--an-line); margin: 10px 0; }
  #skillsFooter { display: flex; flex-direction: column; gap: 9px; }
  .skActions { display: flex; gap: 6px; }
  /* angled-corner terminal buttons, coral for shop / green for publish (matches the SD-card
     collectible palette, which is literal by design rather than theme-driven). */
  /* border-radius 0 beats the global button radius; the notch clip only reads on square
     corners (a rounded border inside the polygon is what made these look like pills). */
  .skBtn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
           height: 26px; padding: 0 12px; font-size: 0.78em; font-weight: 700; letter-spacing: 0.8px;
           font-family: var(--an-mono, ui-monospace, SFMono-Regular, Menlo, monospace); cursor: pointer;
           background: transparent; border-radius: 0;
           clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%); }
  .skBtn.skBtn-pub { border: 1px solid var(--an-green-line); color: var(--an-green); background: var(--an-green-dim); }
  .skBtn.skBtn-pub:hover { background: var(--an-green-soft); }
  .skBtn.skBtn-shop { border: 1px solid #6b3a2a; color: #f6764f; background: rgba(241,90,57,0.06); }
  .skBtn.skBtn-shop:hover { background: rgba(241,90,57,0.13); }
  .skShopForMe { display: flex; align-items: center; gap: 8px; }
  /* terminal-style ">SHOP_FOR_ME [?]" label with a hover tooltip carrying the explanation */
  .sfm-label { position: relative; font-size: 0.66em; font-weight: 700; letter-spacing: 1px;
               color: var(--vscode-descriptionForeground, #9a9ca6); opacity: 0.7; cursor: help; white-space: nowrap; }
  .sfm-label .sfm-q { opacity: 0.55; }
  .sfm-label .sfm-tip { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20; width: 168px;
                        padding: 6px 8px; background: var(--an-bg, #101114); border: 1px solid var(--an-line);
                        color: var(--vscode-descriptionForeground, #9a9ca6); font-size: 1.05em; font-weight: 400;
                        letter-spacing: 0.3px; line-height: 1.5; opacity: 0; pointer-events: none;
                        transition: opacity 0.12s ease; box-shadow: 0 8px 20px rgba(0,0,0,0.5); }
  .sfm-label:hover .sfm-tip { opacity: 1; }
  /* retro scanline switch — rectangular, keeps the .on / .knob contract the JS toggles */
  #shopToggle { position: relative; width: 32px; height: 16px; flex: none; margin-left: auto; padding: 0;
                border: 1px solid var(--an-line); background: var(--an-bg-2); cursor: pointer; overflow: hidden;
                border-radius: 0; /* rectangular retro switch — undo the global button radius */
                transition: background 0.15s, border-color 0.15s; }
  #shopToggle::after { content: ''; position: absolute; inset: 0; pointer-events: none;
                       background: repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0 1px, transparent 1px 3px); }
  #shopToggle .knob { position: absolute; top: 2px; left: 3px; width: 12px; height: 10px;
                      background: var(--an-fg, currentColor); opacity: 0.5; transition: left 0.18s cubic-bezier(0.05,0.7,0.1,1); }
  #shopToggle.on { border-color: var(--an-green-line); background: var(--an-green-dim); }
  #shopToggle.on .knob { left: 17px; background: var(--an-green); opacity: 0.9; }
  /* wide panel: publish/shop shrink to fit, footer becomes one row with the toggle pushed right */
  @container (min-width: 360px) {
    #skillsFooter { flex-direction: row; align-items: center; gap: 10px; }
    .skActions .skBtn { flex: none; padding: 0 16px; }
    .skShopForMe { margin-left: auto; }
    #shopToggle { margin-left: 0; }
  }

  /* ── skill "SD-card" collectible (ported from surfaces/webview). One component drawn
     everywhere skills are listed so the whole app reads as one collection. Graphite plastic
     cartridge (mint for workflows) with a notched tab, a dark recessed label carrying a
     deterministic magic-circle sigil, a barcode + CAT/SKILL mark, the NAME big over the sigil,
     and a coral data chip (supply / price / state) at the foot. Greys are literal to hold the
     collectible look, independent of the VS Code theme. */
  .an-sd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
  .an-sd { position: relative; width: 100%; aspect-ratio: 108 / 150; padding: 6px; border: 0;
           --t: #494c54; --b: #3f424a; --d: #33353b; --chip: #f15a39;
           background: linear-gradient(166deg, var(--t) 0%, var(--b) 56%, var(--d) 100%);
           border-radius: 11px; clip-path: polygon(0 0, 79% 0, 100% 13%, 100% 100%, 0 100%);
           filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45));
           box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.24);
           text-align: left; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
           cursor: pointer; transition: transform 0.1s ease; }
  .an-sd::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
                   z-index: 2; background: radial-gradient(135% 90% at 26% -6%, rgba(255,255,255,0.06), rgba(255,255,255,0) 52%); }
  .an-sd::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
                  z-index: 3; opacity: 0.45; mix-blend-mode: overlay; background-size: 64px 64px;
                  background-image: url("data:image/png;base64,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"); }
  .an-sd.is-workflow { background: linear-gradient(166deg, #d7fffaeb 0%, #c7fdeceb 56%, #8dc3baeb 100%); }
  .an-sd:active { transform: scale(0.97); }
  .an-sd.is-disposed { opacity: 0.5; filter: grayscale(1); }
  .an-sd.is-owned-dim { opacity: 0.5; filter: grayscale(0.55); }
  .an-sd-tab { position: absolute; left: 0; top: 28%; width: 5px; height: 16px; background: var(--chip);
               border-radius: 0 2px 2px 0; z-index: 5; }
  .an-sd-label { position: relative; height: 100%; overflow: hidden; background: #0a0b0e; border-radius: 6px;
                 clip-path: polygon(0 0, 79% 0, 100% 14%, 100% 100%, 0 100%);
                 box-shadow: inset 0 2px 5px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.04); }
  .an-sd-art { position: absolute; inset: 0; width: 100%; height: 100%; }
  .an-sd-label::before { content: ''; position: absolute; inset: 0;
                         background-image: linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
                                           linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
                         background-size: 13px 13px; }
  .an-sd.is-firing .an-sd-label { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chip) 70%, transparent); }
  /* 2a layout (unlock-flow-v2): barcode alone top-left; mark + star share the right axis */
  .an-sd-bar { position: absolute; top: 6px; left: 7px; z-index: 3; width: 26px; height: 9px; opacity: 0.7;
               background: repeating-linear-gradient(90deg, #d4d5ea 0 1px, transparent 1px 2px, #d4d5ea 2px 4px, transparent 4px 5px); }
  .an-sd-mark { position: absolute; top: 21px; right: 7px; z-index: 3; font-size: 8px; font-weight: 700;
                letter-spacing: 0.6px; white-space: nowrap; text-align: right; }
  .an-sd-mark .cat { color: #c7c8d0; }
  .an-sd-mark .ty { color: #9a9ca6; }
  .an-sd-name { position: absolute; left: 7px; right: 8px; bottom: 34px; z-index: 4;
                font-family: "Chakra Petch", "Space Grotesk", ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; font-weight: 700;
                letter-spacing: 0; color: #ffffff; line-height: 1.1; word-break: break-word;
                text-shadow: 0 1px 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.7);
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .an-sd-chip { position: absolute; left: 6px; bottom: 6px; right: 14px; z-index: 4; display: flex;
                align-items: center; gap: 4px; background: var(--chip); padding: 3px 7px; border-radius: 2px;
                box-shadow: inset 0 -1px 0 rgba(0,0,0,0.16); }
  .an-sd-big { font-size: 14px; font-weight: 700; color: #2a0f06; line-height: 1; }
  /* no supply figure (inventory panel): a quiet dark bar stands in, per the 2a chip */
  .an-sd-big.bar { width: 10px; height: 3px; background: #2a0f06; flex: none; }
  .an-sd-meta { font-size: 6px; line-height: 1.3; color: #3a160a; font-weight: 700; letter-spacing: 0.2px; }
  /* 2a star grade: right column under the mark, gold text framed by two corner brackets
     (top-left + bottom-right ticks, not a full box). Hidden at 0 stars. */
  .an-sd-grade { position: absolute; top: 33px; right: 2px; z-index: 6; display: inline-flex;
                 align-items: center; gap: 3px; padding: 3px 5px; color: #ffdf7e;
                 font-size: 11px; font-weight: 700; letter-spacing: 0.5px; line-height: 1.2;
                 text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
  .an-sd-grade::before { content: ''; position: absolute; top: 0; left: 0; width: 6px; height: 6px;
                         border-top: 1.5px solid #ffdf7e; border-left: 1.5px solid #ffdf7e; }
  .an-sd-grade::after { content: ''; position: absolute; bottom: 0; right: 0; width: 6px; height: 6px;
                        border-bottom: 1.5px solid #ffdf7e; border-right: 1.5px solid #ffdf7e; }
  .an-sd-grade .st { font-size: 12px; line-height: 1; }
  /* 4c minted-card face (SD Card Star Fix): the rendered PNG replaces the sigil; the
     barcode + mark drop and the star grade becomes a quiet white box top-left. The
     Chakra Petch face is embedded (latin 700) so the panel needs no network font. */
  @font-face { font-family: "Chakra Petch"; font-style: normal; font-weight: 700; font-display: swap;
               src: url(data:font/woff2;base64,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) format("woff2"); }
  .an-sd-img { position: absolute; inset: 0; margin: auto; width: 84%; aspect-ratio: 1 / 1; object-fit: contain; z-index: 1; }
  .an-sd.has-img .an-sd-bar, .an-sd.has-img .an-sd-mark { display: none; }
  .an-sd.has-img .an-sd-grade { top: 5px; left: 5px; right: auto; padding: 2px 5px; font-size: 10px;
                                color: #ffffff; border: 1px solid rgba(255,255,255,0.35); border-radius: 1px;
                                text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
  .an-sd.has-img .an-sd-grade::before, .an-sd.has-img .an-sd-grade::after { display: none; }

  /* ── Skeleton loaders (shimmer) ─────────────────────────────────────────
     Shown the instant a grid or profile starts fetching, so the first paint
     reads as "this shape is loading" instead of a bare "Loading…" line. Each
     skeleton mirrors the footprint of the real card it stands in for (.an-sd
     cartridge, .an-ac agent card, .an-id id card) so the swap to real content
     does not jump. Reduced-motion safe. */
  @keyframes an-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sk-sh { position: relative; overflow: hidden;
           background: linear-gradient(90deg, var(--an-bg-1) 25%, var(--an-bg-2) 50%, var(--an-bg-1) 75%);
           background-size: 200% 100%; animation: an-shimmer 1.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .sk-sh { animation: none; } }
  .sk-sd { aspect-ratio: 108 / 150; border-radius: 11px;
           clip-path: polygon(0 0, 79% 0, 100% 13%, 100% 100%, 0 100%); }
  .sk-ac { width: 100%; height: 158px; border-radius: 4px; border: 1px solid var(--an-line-soft); }
  .sk-id { width: 100%; height: 208px; border-radius: 4px; border: 1px solid var(--an-line-soft); margin-bottom: 12px; }

  /* ===== SYSTEM // COMMON BUTTON ==========================================
     Ported from the mobile .an-btn at desktop density (padding 20->8px, font
     13->11px, letter-spacing 2->1.2px). Transparent button + corner-tick
     brackets (8 corner gradients) with a solid accent block inset; only
     --acc/--ink swap per variant. .sm is the compact inline variant for
     per-card / search-row buttons. */
  .an-btn { --tk: #6e6e72; --acc: #4ade80; --ink: #06140c;
            position: relative; isolation: isolate; display: inline-flex; align-items: center;
            justify-content: center; gap: 6px; padding: 8px 14px; border: 0; background: transparent;
            cursor: pointer; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700;
            font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ink);
            transition: opacity 0.12s; white-space: nowrap; }
  .an-btn::before { content: ""; position: absolute; inset: 0; z-index: -2; background: var(--an-ticks); }
  .an-btn::after { content: ""; position: absolute; inset: 5px; z-index: -1; background: var(--acc); }
  .an-btn:hover { opacity: 0.92; }
  .an-btn:active { opacity: 0.82; }
  .an-btn:disabled, .an-btn[disabled] { opacity: 0.4; cursor: default; }
  .an-btn-green  { --acc: #4ade80; --ink: #06140c; }
  .an-btn-orange { --acc: #f0913e; --ink: #1a0f06; }
  .an-btn-violet { --acc: #8b5cf6; --ink: #0c0618; }
  .an-btn.sm { padding: 6px 11px; font-size: 10px; letter-spacing: 1px; }
  .an-btn.sm::after { inset: 4px; }
  /* secondary — plain outline, no brackets/fill (ports .an-btn-outline) */
  .an-btn-outline { color: #bdbdbd; border: 1px solid #34343a; }
  .an-btn-outline::before, .an-btn-outline::after { display: none; }

  /* terminal form field + FORM // SECTION header (ports mobile .an-term-field). */
  .an-field { width: 100%; box-sizing: border-box; background: #0d0d10; color: #e8e8ea;
              border: 1px solid #2a2a30; border-radius: 4px; padding: 8px 10px;
              font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.84em;
              outline: none; transition: border-color 0.12s; }
  .an-field:focus { border-color: #4ade80; }
  .an-field.v-focus:focus { border-color: #8b5cf6; }
  .an-field::placeholder { color: #5a5a5d; }
  .an-field:disabled { opacity: 0.5; cursor: not-allowed; }
  textarea.an-field { resize: vertical; line-height: 1.5; }
  .an-formhead { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 700;
                 letter-spacing: 1.4px; text-transform: uppercase; color: #7a7a7f; margin: 2px 0 9px; }
  .an-formhead b { color: #c7c8d0; font-weight: 700; }

  /* Markets full-screen view */
  .mktHead { margin-bottom: 14px; }
  .mktTitle { display: flex; align-items: center; gap: 8px; font-size: 1.15em; font-weight: 700; }
  .mktTitle .wand { width: 18px; height: 18px; color: var(--an-green); }
  .mktSearchRow { display: flex; gap: 8px; margin-bottom: 16px; }
  #mktSearch { flex: 1; min-width: 0; background: var(--an-bg); border: 1px solid var(--an-line);
               border-radius: 0; color: inherit; padding: 9px 12px; font-size: 0.92em; outline: none; }
  #mktSearch:focus { border-color: var(--an-green-line); }
  #mktSearchBtn { background: var(--an-green-dim); border: 1px solid var(--an-green-line); color: var(--an-green);
                  border-radius: var(--an-radius); padding: 9px 16px; font-size: 0.92em; font-weight: 600; cursor: pointer; }
  .mktGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
  .mktCard { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--an-line);
             border-radius: var(--an-radius); background: var(--an-bg); }
  .mktCard .mc-img { width: 40px; height: 40px; border-radius: 8px; background: var(--an-green-dim);
                     display: flex; align-items: center; justify-content: center; flex: none; }
  .mktCard .mc-img .wand { width: 24px; height: auto; color: var(--an-green); display: inline-flex; }
  .mktCard .mc-img .wand svg { width: 100%; height: auto; }
  .mktCard .mc-main { min-width: 0; flex: 1; }
  .mktCard .mc-name { font-weight: 600; }
  .mktCard .mc-desc { opacity: 0.6; font-size: 0.88em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mktCard .mc-sup { opacity: 0.5; font-size: 0.85em; white-space: nowrap; }
  .mktCard .mc-price { color: var(--an-green); font-size: 0.82em; font-weight: 600; white-space: nowrap; }
  .mktCard .mc-buy { background: var(--an-green-dim); border: 1px solid var(--an-green-line); color: var(--an-green);
                     border-radius: var(--an-radius); padding: 6px 14px; cursor: pointer; white-space: nowrap; font-weight: 600; }
  .mktCard .mc-buy[disabled] { opacity: 0.5; cursor: default; }
  .mktGrid .mktEmpty { grid-column: 1 / -1; opacity: 0.5; font-size: 0.9em; padding: 8px 2px; }
  /* a card body is clickable (opens detail); the Buy button stops propagation */
  .mktCard .mc-main { cursor: pointer; }
  .mktCard .mc-main:hover .mc-name { color: var(--an-green); }
  /* Workflow cards read as "crafted/composite": gold frame + gold icon tile + a WORKFLOW
     badge with the count of skills it chains — matching the mobile collectible language. */
  .mktCard.workflow { border-color: #c8922e; background: linear-gradient(135deg, var(--an-bg), color-mix(in srgb, #e0a23a 7%, var(--an-bg))); }
  .mktCard.workflow .mc-img { background: color-mix(in srgb, #e0a23a 18%, transparent); }
  .mktCard.workflow .mc-img .wand { color: #e0a23a; }
  .mktCard.workflow .mc-name:hover, .mktCard.workflow .mc-main:hover .mc-name { color: #e0a23a; }
  .mc-wf { display: inline-flex; align-items: center; gap: 4px; font-size: 0.62em; font-weight: 700;
           letter-spacing: 0.05em; text-transform: uppercase; color: #e0a23a;
           background: color-mix(in srgb, #e0a23a 14%, transparent); border: 1px solid #c8922e55;
           border-radius: 999px; padding: 1px 7px; margin-bottom: 3px; width: fit-content; }
  #mktDetailBody .dt-img.workflow { background: color-mix(in srgb, #e0a23a 18%, transparent); }
  #mktDetailBody .dt-img.workflow .wand { color: #e0a23a; }
  #mktDetailBody .dt-kind.workflow { color: #e0a23a; opacity: 1; }
  /* Skills / Workflows tabs — flat underline marker (ported from the mobile tab bar):
     active = 2px light underline + light mono label; inactive = 1px faint underline + grey. */
  .mktTabRow { display: flex; align-items: flex-end; gap: 0; margin-bottom: 12px; }
  .mktTabs { display: inline-flex; gap: 0; }
  .mktTab { background: transparent; border: none; border-radius: 0; border-bottom: 1px solid #1d1d20; color: #5a5a5d;
            padding: 10px 22px 12px; font-size: 0.9em; font-weight: 700; letter-spacing: 1.5px;
            text-transform: uppercase; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            cursor: pointer; transition: color 0.12s, border-color 0.12s; }
  .mktTab:hover { color: #9a9a9f; }
  .mktTab.on { border-bottom: 2px solid #f2f2f2; color: #f2f2f2; }
  /* market "hide owned" toggle: right-aligned beside the tabs, on by default so the grid surfaces NEW skills */
  .mktFilter { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; opacity: 0.85;
               font-size: 0.82em; cursor: pointer; user-select: none; white-space: nowrap; }
  .mktFilter:hover { opacity: 1; }
  .mktSortBtn { margin-left: 10px; background: transparent; border: 1px solid #2a2a2e; border-radius: 999px;
                color: #9a9a9f; font-size: 0.78em; padding: 2px 10px; cursor: pointer; white-space: nowrap; }
  .mktSortBtn:hover { color: #f2f2f2; border-color: #3a3a3e; }
  .mktSortBtn.stars { color: #e0a23a; border-color: color-mix(in srgb, #e0a23a 45%, transparent); }
  .mktFilter input { margin: 0; accent-color: var(--an-green); cursor: pointer; }
  /* detail sub-view */
  #mktDetailBody .dt-head, #skillModalBody .dt-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  #mktDetailBody .dt-img, #skillModalBody .dt-img { width: 56px; height: 56px; border-radius: 10px; background: var(--an-green-dim);
                           display: flex; align-items: center; justify-content: center; flex: none; }
  #mktDetailBody .dt-img .wand, #skillModalBody .dt-img .wand { width: 34px; height: auto; color: var(--an-green); display: inline-flex; }
  #mktDetailBody .dt-img .wand svg, #skillModalBody .dt-img .wand svg { width: 100%; height: auto; }
  #mktDetailBody .dt-name, #skillModalBody .dt-name { font-size: 1.15em; font-weight: 700; }
  #mktDetailBody .dt-kind, #skillModalBody .dt-kind { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em;
                            color: var(--an-green); opacity: 0.8; }
  #mktDetailBody .dt-desc, #skillModalBody .dt-desc { opacity: 0.85; margin-bottom: 10px; }
  #mktDetailBody .dt-meta, #skillModalBody .dt-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  #mktDetailBody .dt-tag, #skillModalBody .dt-tag { font-size: 0.75em; padding: 2px 9px; border-radius: 999px;
                           background: var(--an-bg); border: 1px solid var(--an-line); opacity: 0.8; }
  #mktDetailBody .dt-sec, #skillModalBody .dt-sec { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em;
                           opacity: 0.5; margin: 14px 0 6px; }
  #mktDetailBody .dt-body, #skillModalBody .dt-body { white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace);
                            font-size: 0.82em; background: var(--an-bg); border: 1px solid var(--an-line);
                            border-radius: var(--an-radius); padding: 10px 12px; max-height: 320px; overflow: auto; }
  #mktDetailBody .dt-buy { background: var(--an-green-dim); border: 1px solid var(--an-green-line); color: var(--an-green);
                           border-radius: var(--an-radius); padding: 8px 18px; cursor: pointer; font-weight: 600; }
  #mktDetailBody .dt-buy[disabled] { opacity: 0.5; cursor: default; }
  /* dispose (Remove) — a quieter, destructive-tinted button beside the disabled "Owned" */
  #mktDetailBody .dt-remove { margin-left: 8px; background: transparent; border: 1px solid var(--an-line);
                              color: var(--vscode-descriptionForeground, #999); border-radius: 0;
                              padding: 8px 16px; cursor: pointer; font-weight: 700;
                              font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px;
                              letter-spacing: 1px; text-transform: uppercase; }
  #mktDetailBody .dt-remove:hover { border-color: var(--vscode-errorForeground, #f48771); color: var(--vscode-errorForeground, #f48771); }
  #mktDetailBody .dt-remove[disabled] { opacity: 0.5; cursor: default; }
  /* a required skill row inside a workflow detail — clickable, opens its detail */
  #mktDetailBody .dt-req { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer;
                           border: 1px solid var(--an-line); border-radius: var(--an-radius); margin-bottom: 6px; }
  #mktDetailBody .dt-req:hover { border-color: var(--an-green-line); background: var(--an-green-dim); }
  #mktDetailBody .dt-req .rq-name { font-weight: 600; }
  #mktDetailBody .dt-req .rq-arrow { margin-left: auto; opacity: 0.5; }
  #mktDetailBody .dt-repo { display: flex; align-items: center; gap: 8px; padding: 8px 11px; text-decoration: none;
                            color: inherit; border: 1px solid var(--an-line); border-radius: 0; margin-bottom: 6px;
                            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82em; }
  #mktDetailBody .dt-repo:hover { border-color: var(--an-green-line); background: var(--an-green-dim); }
  #mktDetailBody .dt-repo .dt-repo-stars { margin-left: auto; color: #e0a23a; font-weight: 700; letter-spacing: 0.5px; }
  /* USED BY total star, as a corner-bracket ghost chip (shares --an-ticks with the OWNED chip) */
  #mktDetailBody .dt-usedby { display: inline-flex; align-items: center; gap: 7px; position: relative; isolation: isolate;
                              padding: 5px 12px; margin: 16px 0 8px; border: 0; background: transparent;
                              font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px;
                              letter-spacing: 1px; text-transform: uppercase; color: var(--vscode-foreground); opacity: 0.9; }
  #mktDetailBody .dt-usedby::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--an-ticks); }
  #mktDetailBody .dt-usedby .uc-star { color: #e0a23a; font-weight: 700; opacity: 1; }
  /* comments section (issue #34) */
  #mktDetailBody .dt-comments { margin-top: 14px; }
  #mktDetailBody .dt-comment { border: 1px solid var(--an-line); border-radius: var(--an-radius);
                               padding: 8px 10px; margin-bottom: 8px; font-size: 0.85em; }
  #mktDetailBody .dt-comment .cm-author { display: flex; align-items: center; gap: 6px; font-size: 0.72em; opacity: 0.6; margin-bottom: 4px; font-family: var(--vscode-editor-font-family, monospace); }
  #mktDetailBody .dt-comment .cm-avatar { width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%; overflow: hidden; background: var(--an-bg); }
  #mktDetailBody .dt-comment .cm-link { cursor: pointer; width: fit-content; }
  #mktDetailBody .dt-comment .cm-link:hover { opacity: 1; }
  #mktDetailBody .dt-comment .cm-link:hover .cm-addr { text-decoration: underline; }
  #mktDetailBody .dt-comment .cm-git { font-size: 0.72em; opacity: 0.6; margin-top: 4px; }
  #mktDetailBody .dt-comment .cm-git a { color: var(--an-green); text-decoration: none; }
  #mktDetailBody .dt-note-input { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  #mktDetailBody .dt-note-input textarea { background: #0d0d10; color: #e8e8ea;
                                          border: 1px solid #2a2a30; border-radius: 4px;
                                          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                                          padding: 8px 10px; font-size: 0.82em; line-height: 1.5; resize: vertical; min-height: 60px; outline: none; }
  #mktDetailBody .dt-note-input textarea:focus { border-color: #4ade80; }
  #mktDetailBody .dt-note-input textarea::placeholder { color: #5a5a5d; }
  #mktDetailBody .dt-note-input .dt-note-submit { align-self: flex-end; background: var(--an-green-dim);
                                                  border: 1px solid var(--an-green-line); color: var(--an-green);
                                                  border-radius: var(--an-radius); padding: 5px 14px; cursor: pointer; font-size: 0.85em; }
  #mktDetailBody .dt-note-input .dt-note-submit[disabled] { opacity: 0.5; cursor: default; }
  #mktDetailBody .dt-note-gate { font-size: 0.78em; opacity: 0.55; font-style: italic; margin-top: 4px; }
  #mktDetailBody .dt-note-error { font-size: 0.78em; color: var(--vscode-errorForeground, #f48771); margin-top: 4px; }

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
               background: var(--an-bg-2); overflow: visible; transition: border-color 0.12s;
               position: relative; }
  #input { width: 100%; box-sizing: border-box; padding: 11px 12px 8px; background: transparent;
           color: var(--vscode-input-foreground); border: none; resize: none; font-family: inherit;
           font-size: 0.95em; display: block; line-height: 1.5;
           /* autoGrow JS caps the height (~2.5x) via inline style; this scrolls past it */
           overflow-y: auto; }
  #input:focus { outline: none; }
  #input:disabled { opacity: 0.5; cursor: not-allowed; }
  #inputWrap:focus-within { box-shadow: 0 0 0 2px var(--engSoft); }
  /* composer frozen while a tool approval is pending (input value is kept, just locked) */
  #composer.locked #inputWrap { opacity: 0.6; }
  #composer.locked #send { opacity: 0.4; cursor: not-allowed; }

  /* Keep DOM order when wrapping: send stays last, aligned right on the final row. */
  #controls { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; padding: 4px 8px 7px; font-size: 0.82em; }
  #model { background: var(--an-bg-1); color: var(--vscode-foreground);
           border: 1px solid var(--an-line); border-radius: 6px; padding: 3px 7px; font-size: 0.92em; }
  /* permission-mode picker, modelled on the mode pickers in Claude Code / Codex
     rather than a raw OS select: an engine-tinted chip showing the current mode,
     and a popover that lists each mode with a one-line description. The popover is
     position:fixed so it escapes #inputWrap's overflow:hidden (which would clip it). */
  #modeWrap { position: relative; display: inline-flex; }
  #modeBtn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
             background: var(--engSoft); color: var(--vscode-foreground); font-weight: 600;
             border: 1px solid var(--engLine); border-radius: 999px; padding: 3px 10px;
             font-size: 0.92em; font-family: inherit; }
  #modeBtn:hover { border-color: var(--eng); }
  #modeBtn .mcaret { opacity: 0.5; font-size: 0.8em; }
  #modeMenu { position: fixed; z-index: 60; min-width: 234px; padding: 5px;
              background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
              border: 1px solid var(--an-line); border-radius: var(--an-radius);
              box-shadow: 0 8px 28px rgba(0,0,0,0.4); }
  .modeOpt { display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px;
             border-radius: var(--an-radius-sm); cursor: pointer; }
  .modeOpt:hover { background: var(--an-bg-1); }
  .modeOpt.sel { background: var(--engSoft); }
  .modeOpt .mtext { flex: 1; min-width: 0; }
  .modeOpt .mlabel { font-weight: 600; font-size: 0.92em; }
  .modeOpt .mdesc { font-size: 0.78em; opacity: 0.6; margin-top: 1px; line-height: 1.35; }
  .modeOpt .mcheck { color: var(--eng); font-weight: 700; opacity: 0; flex: none; }
  .modeOpt.sel .mcheck { opacity: 1; }
  /* model chip: same chip+popover language as the mode chip, but neutral (un-tinted)
     so the engine-colored mode chip stays the prominent one. */
  #modelWrap { position: relative; display: inline-flex; }
  #modelBtn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
              background: var(--an-bg-1); color: var(--vscode-foreground); font-weight: 600;
              border: 1px solid var(--an-line); border-radius: 999px; padding: 3px 10px;
              font-size: 0.92em; font-family: inherit; }
  #modelBtn:hover { border-color: var(--eng); }
  #modelBtn .mglyph { opacity: 0.5; font-size: 0.82em; font-weight: 700; letter-spacing: 0.02em; }
  #modelBtn .mcaret { opacity: 0.5; font-size: 0.8em; }
  #modelMenu { position: fixed; z-index: 60; min-width: 260px; max-width: min(360px, calc(100vw - 24px)); padding: 5px;
               background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
               border: 1px solid var(--an-line); border-radius: var(--an-radius);
               box-shadow: 0 8px 28px rgba(0,0,0,0.4); }
  /* effort lives inside the mode popover rather than as its own chip: it modifies how the
     engine runs, same as the mode does, so it belongs to that menu. Chips (not rows) keep
     six levels compact under the mode list instead of doubling the popover's height. */
  .mdiv { height: 1px; background: var(--an-line); margin: 5px 7px; }
  .mSection { font-size: 0.7em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
              opacity: 0.5; padding: 4px 9px 6px; }
  .effChips { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 9px 7px; }
  .effChip { padding: 3px 10px; border-radius: 999px; cursor: pointer; font-family: inherit;
             font-size: 0.82em; font-weight: 600; opacity: 0.75;
             background: var(--an-bg-1); color: var(--vscode-foreground);
             border: 1px solid var(--an-line); }
  .effChip:hover { opacity: 1; border-color: var(--eng); }
  .effChip.sel { background: var(--engSoft); border-color: var(--eng); color: var(--eng); opacity: 1; }
  /* the "· high" tail on the mode chip — only rendered when effort is off its default,
     so the chip stays short until there's actually something to report */
  #modeEffortTag { opacity: 0.65; font-weight: 500; }
  /* context-token chip: secondary, revealed by clicking the usage gauge (or shown as a
     fallback when the account reports no plan usage at all) */
  #ctxMeter { font-size: 0.82em; opacity: 0.55; display: inline-flex; align-items: center; }
  /* plan rate-limit gauge: the primary usage chip — a thin bar + percent, shown whenever the
     plan reports utilization. Amber past 80%. Click to also reveal the context-token chip. */
  #limitMeter { font-size: 0.82em; display: inline-flex; align-items: center; gap: 5px; }
  #limitMeter .lm-track { width: 42px; height: 5px; border-radius: 999px; background: var(--an-line); overflow: hidden; }
  #limitMeter .lm-fill { display: block; height: 100%; width: 0; background: var(--an-green); transition: width .3s ease; }
  #limitMeter .lm-pct { opacity: 0.6; }
  #limitMeter.warn .lm-fill { background: var(--an-amber); }
  #limitMeter.warn .lm-pct { color: var(--an-amber); opacity: 0.9; }
  /* slash command dropdown menu */
  .slashMenu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--an-line);
    border-radius: var(--an-radius-sm, 6px);
    box-shadow: 0 -8px 28px rgba(0,0,0,0.4);
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
    display: none;
    flex-direction: column;
    gap: 2px;
  }
  .slashOpt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    user-select: none;
    color: var(--vscode-foreground);
    text-align: left;
  }
  .slashOpt.sel {
    background: var(--vscode-list-activeSelectionBackground, var(--eng));
    color: var(--vscode-list-activeSelectionForeground, #fff);
  }
  .slashOpt .cmd {
    font-weight: 600;
  }
  .slashOpt .desc {
    opacity: 0.7;
    font-size: 0.9em;
  }
  .slashHint {
    font-size: 0.76em;
    opacity: 0.5;
    padding: 6px 10px;
    border-top: 1px solid var(--an-line);
    margin-top: 4px;
    user-select: none;
    color: var(--vscode-foreground);
    text-align: left;
  }
  /* send/stop: a single small, flat, round icon button (Claude/Codex style) —
     no text, no gradient, no lift. Engine accent when ready, neutral when empty. */
  #send { margin-left: auto; display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; padding: 0; flex: none;
          color: #fff; border: none; border-radius: 999px; cursor: pointer;
          background: var(--eng); transition: background 0.12s ease, opacity 0.12s ease; }
  #send:hover { background: color-mix(in srgb, var(--eng) 88%, #fff); }
  #send:disabled { background: var(--an-bg-2, var(--an-bg-1)); color: var(--vscode-foreground);
                   opacity: 0.4; cursor: default; }
  #send svg { width: 15px; height: 15px; flex: none; }
  /* inline drawn icons (replace the old decorative emoji): size to the
     surrounding text via 1em + inherit its color via currentColor. */
  .anic { width: 1em; height: 1em; flex: none; vertical-align: -0.14em; }
  #send .lbl { display: none; }
  #send .ic-stop { display: none; }
  #send.stopping .ic-send { display: none; }
  #send.stopping .ic-stop { display: inline-block; }
  #send.stopping { background: var(--vscode-foreground); color: var(--vscode-editor-background); opacity: 0.85; }
  #send.stopping:hover { opacity: 1; }

  /* attach (paperclip): a quiet icon button that tints to the engine accent on hover */
  #attachBtn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
               padding: 0; background: var(--an-bg-1); color: var(--vscode-foreground); opacity: 0.75;
               border: 1px solid var(--an-line); border-radius: 999px; cursor: pointer; }
  #attachBtn svg { width: 15px; height: 15px; }
  #attachBtn:hover { opacity: 1; border-color: var(--eng); color: var(--eng); }
  /* thumbnails of attached images, above the textarea. Each is a tile with a hover × */
  #attachStrip { display: flex; flex-wrap: wrap; gap: 7px; padding: 9px 10px 2px; }
  .thumb { position: relative; width: 52px; height: 52px; border-radius: 7px; overflow: hidden;
           border: 1px solid var(--engLine); background: var(--an-bg-1); flex: 0 0 auto; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .rm { position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; border-radius: 50%;
               border: none; cursor: pointer; font-size: 11px; line-height: 16px; padding: 0; text-align: center;
               background: rgba(0,0,0,0.66); color: #fff; opacity: 0; transition: opacity 0.1s; }
  .thumb:hover .rm { opacity: 1; }
  /* drag-over affordance: the whole input box glows in the engine accent */
  #inputWrap.dragover { border-color: var(--eng); box-shadow: 0 0 0 2px var(--engSoft); }
  /* a sent user bubble's image row (live thumbs) + the history "N image" chip */
  .msgImgs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .msgImgs img { max-width: min(168px, 100%); max-height: 168px; border-radius: 8px; border: 1px solid var(--an-line); display: block; }
  .imgChip { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; padding: 2px 9px;
             font-size: 0.82em; opacity: 0.7; border: 1px solid var(--an-line); border-radius: 999px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; border-radius: 6px; cursor: pointer; }

  /* ── issue #35: agent directory + profile ── */
  /* #agentsBtn now shares the Markets pill style (see #tabs); no separate .on rule */

  /* the agents panel scrolls under a sticky self-card + wallet search (mobile parity) */
  #agentsView .page { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow-y: auto; }
  .agSticky { position: sticky; top: 0; z-index: 5; background: var(--vscode-editor-background); padding-bottom: 10px; }
  .agSearch { display: flex; align-items: center; gap: 9px; height: 38px; padding: 0 12px;
              background: #0b0b0c; border: 1px solid #2a2a2e; margin-top: 10px; }
  .agSearch svg { flex: none; }
  .agSearch input { flex: 1; min-width: 0; background: transparent; border: none; outline: none;
                    color: #e8e8e8; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
                    text-transform: uppercase; letter-spacing: 0.04em; }
  .agSearch input::placeholder { color: #6a6a6a; text-transform: uppercase; }
  .agList { display: flex; flex-direction: column; gap: 10px; }
  .agEmpty { padding: 40px 0; text-align: center; font-size: 11px; text-transform: uppercase;
             letter-spacing: 0.08em; color: #5a5a5d; font-family: ui-monospace, Menlo, monospace; }

  /* AGENT cyberpunk "business-card" — ported verbatim from the mobile directory (.an-ac).
     Literal greys hold the mono terminal look (theme-independent on purpose); --accent is
     set inline per card from the wallet hue, the single colour each card carries. */
  /* No forced aspect-ratio: the mobile 350/196 card shape ballooned the height on the
     wider webview panel, which stretched the avatar cell into a tall sliver and floated
     the stats in a sea of empty space. Let the card size to its content instead. */
  .an-ac { position: relative; width: 100%; background: #0a0a0c;
           border: 1px solid #34343a; --accent: #9a9aa3; padding: 8px; overflow: hidden;
           box-shadow: 0 6px 22px rgba(0,0,0,0.55); text-align: left; color: #ececf0;
           font-family: ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer;
           transition: transform 0.1s ease; }
  .an-ac::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 6;
                  background: repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 1px, transparent 1px 3px); }
  .an-ac:active { transform: scale(0.99); }
  .an-ac.is-self { border-color: color-mix(in srgb, var(--accent) 55%, #34343a);
                   box-shadow: 0 6px 22px rgba(0,0,0,0.55), inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
  /* No height:100% — the card is auto-height now, so a 100% here only invited a sub-pixel
     clip of the foot under the card's overflow:hidden. Extra bottom padding gives EARNED air. */
  .an-ac-in { position: relative; border: 1px solid #34343a; padding: 7px 9px 9px; display: flex; flex-direction: column; }
  .an-ac-top { display: flex; justify-content: space-between; align-items: center; font-size: 8px; letter-spacing: 0.5px; color: #82828c; }
  .an-ac-hand { color: #ececf0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .an-ac-sig { display: flex; align-items: center; gap: 5px; flex: none; }
  .an-ac-batt { display: inline-block; width: 20px; height: 9px; border: 1px solid #82828c; position: relative; }
  .an-ac-batt::before { content: ""; position: absolute; right: -3px; top: 2px; width: 2px; height: 3px; background: #82828c; }
  .an-ac-batt i { position: absolute; left: 1px; top: 1px; bottom: 1px; background: #82828c; }
  .an-ac-namerow { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #34343a; padding: 6px 0 8px; }
  .an-ac-kana { font-size: 8px; color: #82828c; letter-spacing: 3px; margin-bottom: 2px; }
  /* padding-bottom + a slightly taller line-height: the gradient is clipped to the text, and
     background paints only inside the box, so a tight 0.82 line-height left italic descenders
     (the Q tail) below the box unpainted, i.e. transparent. Extend the box to cover them. */
  .an-ac-name { font-family: "Saira Condensed", "Space Grotesk", ui-sans-serif, sans-serif; font-weight: 800;
                font-style: italic; font-size: 30px; line-height: 0.9; letter-spacing: 1px; padding-bottom: 5px;
                background: linear-gradient(178deg, #ffffff 0%, #d4d4db 36%, #6f6f78 54%, #b8b8c0 70%, #efeff3 100%);
                -webkit-background-clip: text; background-clip: text; color: transparent; }
  .an-ac-access { text-align: right; font-size: 8px; color: #82828c; letter-spacing: 1.5px; line-height: 1.55; flex: none; }
  .an-ac-you { color: var(--accent); font-weight: 700; }
  .an-ac-tier { display: inline-block; margin-top: 2px; background: var(--accent); color: #0a0a0c; font-weight: 700; letter-spacing: 1.2px; padding: 1px 6px; }
  .an-ac-tier.unranked { color: #c7c8d0; background: transparent; border: 1px solid #4a4a52; padding: 0 5px; }
  .an-ac-body { flex: 1; display: grid; grid-template-columns: 74px 1fr; gap: 10px; padding-top: 8px; min-height: 0; }
  .an-ac-ava { position: relative; border: 1px solid #34343a; overflow: hidden; background: #08080a; }
  .an-ac-ava svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .an-ac-attr { display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; }
  .an-ac-rank { font-size: 7.5px; color: #82828c; letter-spacing: 2px; margin-bottom: 4px; }
  .an-ac-gauge { display: flex; align-items: center; gap: 8px; }
  .an-ac-gauge .lab { font-size: 9px; letter-spacing: 1px; color: #ececf0; white-space: nowrap; }
  .an-ac-segs { display: flex; gap: 2px; flex: 1; min-width: 0; }
  .an-ac-segs i { flex: 1; height: 12px; border: 1px solid #82828c; }
  .an-ac-segs i.on { background: var(--accent); border-color: var(--accent); }
  .an-ac-gauge .val { font-size: 10px; font-weight: 700; white-space: nowrap; color: #ececf0; }
  .an-ac-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .an-ac-stat { border: 1px solid #34343a; padding: 3px 7px; }
  .an-ac-stat .k { font-size: 6.5px; color: #82828c; letter-spacing: 1.2px; }
  .an-ac-stat .v { font-size: 15px; font-weight: 700; line-height: 1.05; }
  .an-ac-foot { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #34343a; margin-top: 7px; padding-top: 6px; font-size: 8px; color: #82828c; letter-spacing: 1.5px; }
  .an-ac-foot .earn { color: #d8d9e0; }
  .an-ac-box { width: 13px; height: 13px; border: 1px solid #82828c; position: relative; flex: none; }
  .an-ac-box::before { content: ""; position: absolute; left: 2px; right: 2px; top: 4px; height: 1px; background: #82828c; }
  .an-ac-box::after { content: ""; position: absolute; left: 50%; top: 4px; bottom: 2px; width: 1px; background: #82828c; }

  /* AGENT PROFILE hero — large portrait ID card (.an-id), ported from the mobile profile.
     --tier (current tier colour) set inline; mono = Space Mono fallback, chrome name = Saira. */
  .an-id { position: relative; background: #0a0a0c; border: 1px solid var(--an-line); padding: 12px; overflow: hidden; box-shadow: 0 14px 44px rgba(0,0,0,0.5); margin-bottom: 12px; }
  .an-id::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 6; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px); }
  .an-id::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 7; background: radial-gradient(120% 80% at 50% 0%, transparent 55%, rgba(0,0,0,0.45) 100%); }
  .an-id-in { position: relative; z-index: 8; border: 1px solid var(--an-line); padding: 12px 14px; display: flex; flex-direction: column; }
  .an-id-namerow { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 4px 0 12px; }
  .an-id-role { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: var(--an-fg-mute); letter-spacing: 3px; margin-bottom: 4px; }
  .an-id-name { font-family: "Saira Condensed", "Space Grotesk", ui-sans-serif, sans-serif; font-weight: 800; font-style: italic;
                font-size: 46px; line-height: 0.82; letter-spacing: 1px;
                background: linear-gradient(178deg, #ffffff 0%, #d4d4db 36%, #6f6f78 54%, #b8b8c0 70%, #efeff3 100%);
                -webkit-background-clip: text; background-clip: text; color: transparent; }
  .an-id-tail { font-family: ui-monospace, Menlo, monospace; text-align: right; font-size: 10px; color: var(--an-fg-mute); letter-spacing: 1px; line-height: 1.6; }
  .an-id-body { display: grid; grid-template-columns: 160px 1fr; gap: 14px; }
  .an-id-ava { position: relative; aspect-ratio: 1 / 1.1; border: 1px solid var(--an-line); overflow: hidden; background: #08080a; }
  .an-id-ava > svg, .an-id-ava svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .an-id-ava .tag { position: absolute; left: 5px; bottom: 4px; z-index: 2; font-family: ui-monospace, Menlo, monospace; font-size: 9px; color: var(--an-fg-mute); letter-spacing: 1px; }
  .an-id-info { display: flex; flex-direction: column; justify-content: space-between; min-width: 0; padding: 2px 0; }
  .an-id-bigstat { display: flex; align-items: flex-end; gap: 0; border-bottom: 1px solid var(--an-line); padding-bottom: 9px; }
  .an-id-bigstat:last-child { border-bottom: none; padding-bottom: 0; }
  .an-id-bigstat .k { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: var(--an-fg-mute); letter-spacing: 2px; line-height: 1; padding-bottom: 4px; white-space: nowrap; }
  .an-id-bigstat .lead { flex: 1; border-bottom: 2px dotted var(--an-fg-mute); opacity: 0.5; margin: 0 8px 8px; min-width: 14px; }
  .an-id-bigstat .v { font-family: "Saira Condensed", "Space Grotesk", ui-sans-serif, sans-serif; font-weight: 800; font-style: italic; font-size: 40px; line-height: 0.82; color: var(--an-fg); }
  .an-id-ladder { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .an-id-ladder .lab { font-family: ui-monospace, Menlo, monospace; font-size: 9px; color: var(--an-fg-mute); letter-spacing: 2px; white-space: nowrap; }
  .an-id-rungs { display: flex; gap: 4px; flex: 1; }
  .an-id-rung { position: relative; flex: 1; text-align: center; font-family: ui-monospace, Menlo, monospace; font-size: 8.5px; letter-spacing: 0.5px; padding: 5px 0; border: 1px solid var(--an-fg-mute); color: var(--an-fg-mute); overflow: hidden; }
  .an-id-rung.done { background: #222227; color: #b9b9c0; border-color: #2c2c32; }
  .an-id-rung.cur { background: var(--tier); color: #0d0904; border-color: var(--tier); font-weight: 700; }
  .an-id-gauge { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .an-id-gauge .lab { font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: 1px; color: var(--an-fg-mute); white-space: nowrap; }
  .an-id-segs { display: flex; gap: 2px; flex: 1; min-width: 0; }
  .an-id-segs i { flex: 1; height: 12px; border: 1px solid var(--an-fg-mute); }
  .an-id-segs i.on { background: var(--tier); border-color: var(--tier); }
  .an-id-gauge .val { font-family: ui-monospace, Menlo, monospace; font-size: 12px; font-weight: 700; white-space: nowrap; color: var(--an-fg); }

  /* WORK card (.an-tfolder) — verified GitHub repos as terminal-folder cards in a swipe row.
     --c = muted tier accent, --e = gauge empty-segment colour (set inline per repo). */
  .an-vwork { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
  .an-tfolder { position: relative; width: 270px; flex: none; filter: drop-shadow(0 14px 22px rgba(0,0,0,0.55)); }
  /* the whole card is a link to the repo (issue #210 follow-up) */
  a.an-tfolder { display: block; text-decoration: none; color: inherit; cursor: pointer; }
  .an-tfolder-clip { position: relative; background: #0c0c0d; clip-path: polygon(0 7%, 50% 7%, 58% 24%, 100% 24%, 100% 100%, 0 100%); padding: 5px; }
  .an-tfolder-screen { position: relative; margin-top: 28px; height: 150px; overflow: hidden; border-radius: 3px; padding: 11px 13px; }
  .an-tfolder-bin { position: absolute; inset: 0; color: var(--c); opacity: 0.1; font: 700 9px ui-monospace, Menlo, monospace; line-height: 1.45; letter-spacing: 1px; word-break: break-all; padding: 6px; user-select: none; pointer-events: none; }
  .an-tfolder-label { position: relative; font: 700 8px ui-monospace, Menlo, monospace; letter-spacing: 0.5px; color: var(--c); }
  .an-tfolder-owner { position: relative; font: 700 8px ui-monospace, Menlo, monospace; letter-spacing: 0.5px; color: #9a9a9a; margin-top: 9px; }
  .an-tfolder-name { position: relative; display: flex; align-items: center; gap: 8px; margin-top: 2px; color: #f2f2f2; font: 700 22px ui-monospace, Menlo, monospace; letter-spacing: 0.5px; }
  .an-tfolder-name-t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .an-tfolder-foot { position: absolute; left: 13px; right: 13px; bottom: 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .an-tfolder-stars { display: flex; align-items: center; gap: 6px; flex: none; }
  .an-tfolder-stars-n { font: 700 15px ui-monospace, Menlo, monospace; color: var(--c); }
  .an-tfolder-gauge { display: flex; gap: 2px; align-items: center; }
  .an-tfolder-gauge i { width: 4px; height: 14px; transform: skewX(-12deg); background: var(--e); }
  .an-tfolder-gauge i.on { background: var(--c); }
  .pr-sec { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.72em; font-weight:700;
            text-transform:uppercase; letter-spacing:1.4px; color:#7a7a7f; margin:14px 0 8px; }
  .pr-sec b { color:#c7c8d0; font-weight:700; }
  /* Blog = horizontal snap-scroll carousel: newest card leftmost, scroll right for older.
     Also click-and-drag to scroll (enableDragScroll) — cursor:grab signals it. */
  .pr-blog { display:flex; gap:10px; overflow-x:auto; scroll-snap-type:x proximity;
             margin:10px 0; padding:2px 2px 10px; scroll-padding-left:2px;
             -webkit-overflow-scrolling:touch; cursor:grab; }
  .pr-blog:focus-visible { outline:1px solid var(--an-green); outline-offset:2px; border-radius:4px; }
  .pr-blog.dragging { cursor:grabbing; scroll-snap-type:none; }
  .pr-blog.dragging * { user-select:none; cursor:grabbing; }
  .pr-blog::-webkit-scrollbar { height:8px; }
  .pr-blog::-webkit-scrollbar-thumb { background:var(--an-line); border-radius:4px; }
  .pr-blog .pr-note { flex:0 0 240px; box-sizing:border-box; margin-bottom:0;
                      padding:11px 13px; background:var(--an-bg-2); border:1px solid var(--an-line);
                      border-radius:9px; scroll-snap-align:start; display:flex; flex-direction:column; }
  .pr-note { margin-bottom:8px; }
  .pr-note-author { font-size:0.78em; color:var(--an-muted,#888); margin-bottom:2px; }
  .pr-note-body { flex:1; word-break:break-word; }
  .pr-note-git { font-size:0.78em; margin-top:3px; }
  .gh-card { display:block; margin-top:8px; padding:8px 10px; border:1px solid var(--an-line);
             border-radius:8px; background:rgba(255,255,255,0.025); text-decoration:none;
             color:var(--vscode-foreground); }
  .gh-card:hover { border-color:var(--an-green-line); background:var(--an-bg-1); }
  .gh-kind { display:block; font-size:0.7em; font-weight:700; letter-spacing:.05em;
             text-transform:uppercase; color:var(--an-green); }
  .gh-title { display:block; margin-top:2px; font-weight:650; white-space:nowrap;
              overflow:hidden; text-overflow:ellipsis; }
  .gh-meta { display:block; margin-top:2px; font-size:0.82em; color:var(--an-muted,#888);
             white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pr-note-foot { display:flex; align-items:center; justify-content:space-between; gap:8px;
                  margin-top:8px; padding-top:6px; border-top:1px solid var(--an-line);
                  font-size:0.72em; color:var(--an-muted,#888); }
  .pr-note-date { white-space:nowrap; }
  .pr-note-tx { white-space:nowrap; text-decoration:none; color:var(--an-green); opacity:.85; }
  .pr-note-tx:hover { opacity:1; text-decoration:underline; }
  .pr-compose { margin-top:10px; }
  .pr-reply { margin-left:18px; border-left:2px solid var(--an-line, #333); }
  .pr-replyto { font-size:0.72em; opacity:0.6; margin-bottom:3px; }
  .pr-replybar { margin-top:6px; }
  .pr-replybtn { background:none; border:none; color:var(--an-fg-mute, #888); font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.72em; text-transform:uppercase; letter-spacing:1px; cursor:pointer; padding:0; }
  .pr-replybtn:hover { color:var(--an-fg, #ddd); }
  .pr-replycompose { margin-top:6px; }
  .pr-compose textarea { width:100%; box-sizing:border-box; min-height:60px; padding:8px 10px;
                         background:#0d0d10; color:#e8e8ea; outline:none;
                         border:1px solid #2a2a30; border-radius:4px; resize:vertical;
                         font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.84em; line-height:1.5; }
  .pr-compose input[type=text] { width:100%; box-sizing:border-box; padding:8px 10px; margin-top:6px;
                                  background:#0d0d10; color:#e8e8ea; outline:none;
                                  border:1px solid #2a2a30; border-radius:4px;
                                  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.82em; }
  .pr-compose textarea:focus, .pr-compose input[type=text]:focus { border-color:#4ade80; }
  .pr-compose textarea::placeholder, .pr-compose input[type=text]::placeholder { color:#5a5a5d; }
  .pr-compose button { margin-top:6px; padding:5px 14px; }
  .pr-compose .pr-err { color:#e05252; font-size:0.82em; margin-top:4px; display:none; }
  .pr-compose .pr-err.ok { color:var(--an-green,#3fb950); }
  .pr-compose .pr-hint { opacity:0.55; font-size:0.8em; margin-bottom:6px; }
  .pr-compose textarea:disabled, .pr-compose input:disabled { opacity:0.5; cursor:not-allowed; }
  /* buy-all: minimal outline pill (matches the market's .mc-buy tone, not a heavy fill) */
  .pr-buyall { display:inline-flex; align-items:center; gap:6px; margin:2px 0 10px; padding:6px 14px;
               background:var(--an-green-dim); border:1px solid var(--an-green-line); color:var(--an-green);
               font-weight:600; font-size:0.86em; border-radius:999px; cursor:pointer; transition:background .12s; }
  .pr-buyall:hover { background:var(--an-green-soft); }
  .pr-buyall:disabled { opacity:0.5; cursor:not-allowed; }
  .pr-confirm { background:var(--an-bg-2); border:1px solid var(--an-line); border-radius:var(--an-radius);
                padding:12px; margin:10px 0; }
  .pr-confirm ul { margin:6px 0 10px 16px; font-size:0.88em; }
  .pr-confirm .confirm-btns { display:flex; gap:8px; }
  .pr-confirm .confirm-btns button { flex:1; border-radius:var(--an-radius-sm); }

  /* ── agent profile redesign ─────────────────────────────────────────────
     header = identity card (left) beside a reputation stat card (right);
     skills shown as market-style cards that open a popup; Skills/Notes tabs. */
  .pr-header { display:flex; flex-wrap:wrap; gap:12px; align-items:stretch; margin-bottom:12px; }
  .pr-header .card { margin-bottom:0; }
  .pr-id { flex:2 1 200px; min-width:0; display:flex; align-items:center; gap:12px; }
  .pr-id #wAvatarBig { margin:0; flex:none; }
  .pr-id-txt { min-width:0; }
  .pr-id .addr { font-size:0.8em; }
  .pr-rep { flex:1 1 150px; display:flex; flex-direction:column; gap:8px; }
  .pr-rep-title { font-size:0.68em; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                  color:var(--an-muted,#888); }
  .pr-rep-stats { display:flex; flex-direction:column; gap:7px; }
  .pr-rep-stat { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
  .pr-rep-stat .v { font-size:1.05em; font-weight:700; color:var(--an-green); }
  .pr-rep-stat .l { font-size:0.78em; opacity:0.6; }
  /* Agent / Community tabs — full-width flat underline marker + kana subtitle (ported
     from the mobile profile tab bar). flex:1 halves form one continuous straight baseline. */
  .pr-tabs { display:flex; gap:0; margin:8px 0 16px; }
  .pr-tab { flex:1; background:transparent; border:none; border-radius:0; border-bottom:1px solid #1d1d20; color:#5a5a5d;
            padding:11px 8px 13px; text-align:center; cursor:pointer;
            transition:color 0.12s, border-color 0.12s; }
  .pr-tab .t { font-size:0.9em; font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
               font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .pr-tab .k { font-size:0.6em; margin-top:4px; letter-spacing:0.5px; color:#34343a; }
  .pr-tab:hover { color:#9a9a9f; }
  .pr-tab.on { border-bottom:2px solid #f2f2f2; color:#f2f2f2; }
  .pr-tab.on .k { color:#5a5a5d; }
  /* issue #210: AGENTNET FEED — ported from the mobile BlogFeed/BlogPostView so the two
     surfaces read identically: square 1px frames, mono uppercase labels, a bordered
     "bumped Xh" chip, corner ticks on bumped rows (ACTIVE sort only), a //BLOG foot,
     the //AUTHOR_ row, the >COMMENTS thread with [Reply], and the bracket FAB. */
  .fd-mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .fd-head { display:flex; align-items:center; justify-content:space-between; margin:2px 0 10px; }
  .fd-cap { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:9px;
            letter-spacing:0.16em; text-transform:uppercase; color:var(--an-fg-mute); }
  .fd-sort { display:flex; border:1px solid var(--an-line); }
  .fd-sort button { background:transparent; border:none; color:var(--an-fg-mute); cursor:pointer;
                    font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:9px; font-weight:700;
                    letter-spacing:0.12em; text-transform:uppercase; padding:5px 11px; }
  .fd-sort button + button { border-left:1px solid var(--an-line); }
  .fd-sort button.on { background:var(--an-green-dim); color:var(--an-green); }
  .fd-row { position:relative; display:block; width:100%; text-align:left; border:1px solid var(--an-line);
            background:transparent; padding:11px 12px; margin-bottom:10px; cursor:pointer; }
  .fd-row:hover { border-color:var(--an-line-soft); }
  /* the mobile BUMP_TICKS frame: fg-colored ticks in all four corners */
  .fd-row.bumped { background:
    linear-gradient(var(--an-fg),var(--an-fg)) left top/8px 1.5px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) left top/1.5px 8px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) right top/8px 1.5px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) right top/1.5px 8px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) left bottom/8px 1.5px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) left bottom/1.5px 8px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) right bottom/8px 1.5px no-repeat,
    linear-gradient(var(--an-fg),var(--an-fg)) right bottom/1.5px 8px no-repeat; }
  .fd-top { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .fd-ava { width:24px; height:24px; overflow:hidden; flex:none; border:1px solid var(--an-line); }
  .fd-ava svg { width:100%; height:100%; display:block; }
  .fd-wallet { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; color:var(--an-fg); }
  .fd-when { margin-left:auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
             font-size:9px; white-space:nowrap; color:var(--an-fg-mute); }
  .fd-when.chip { border:1px solid var(--an-line-soft); padding:2px 6px; color:var(--an-fg); }
  .fd-title { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:700; font-size:12px;
              text-transform:uppercase; letter-spacing:0.04em; line-height:1.3; margin:0; color:var(--an-fg); }
  .fd-snip { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.5;
             margin-top:5px; color:var(--an-fg-mute); white-space:pre-wrap; word-break:break-word;
             display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .fd-cover { position:relative; margin-top:10px; height:118px; border:1px solid var(--an-line); overflow:hidden; }
  .fd-cover img { width:100%; height:100%; object-fit:cover; display:block; }
  .fd-cover::after { content:''; position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px); }
  .fd-foot { display:flex; align-items:center; gap:12px; margin-top:10px;
             font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:9px;
             letter-spacing:0.06em; text-transform:uppercase; color:var(--an-fg-mute); }
  .fd-foot .tag { margin-left:auto; }
  .sk-fd { height:96px; margin-bottom:10px; }
  /* FEED post reader — the mobile BlogPostView chrome */
  .fdp-cap { display:flex; align-items:center; justify-content:space-between; margin:0 0 6px;
             font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px;
             letter-spacing:0.14em; text-transform:uppercase; color:var(--an-fg-mute); }
  .fdp-bar { display:flex; align-items:center; gap:10px; border:1px solid var(--an-line);
             padding:10px 12px; margin-bottom:12px; }
  .fdp-bar .bk { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; font-weight:700;
                 color:var(--an-fg-mute); cursor:pointer; background:none; border:none; padding:0; }
  .fdp-bar .tt { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; font-weight:700;
                 letter-spacing:0.14em; text-transform:uppercase; color:var(--an-fg); }
  .fdp-bar .dt { margin-left:auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
                 font-size:10px; letter-spacing:1px; color:var(--an-fg-mute); }
  .fdp-hero { position:relative; margin-bottom:14px; height:176px; border:1px solid var(--an-green); overflow:hidden; }
  .fdp-hero img { width:100%; height:100%; object-fit:cover; display:block; }
  .fdp-hero::after { content:''; position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px); }
  .fdp-title { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:15px; font-weight:700;
               text-transform:uppercase; letter-spacing:0.04em; line-height:1.35; margin:0; color:var(--an-fg); }
  .fdp-author { display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding:8px 0;
                margin-top:10px; border-top:1px solid var(--an-line); border-bottom:1px solid var(--an-line);
                font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .fdp-author .lb { font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--an-fg); }
  .fdp-author .who { font-size:10px; color:var(--an-fg-mute); }
  .fdp-body { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.6;
              margin-top:12px; color:var(--an-fg); white-space:pre-wrap; word-break:break-word; }
  .fdp-cmts { margin-top:22px; padding-top:14px; border-top:1px solid var(--an-line); }
  .fdp-cmts-cap { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; font-weight:700;
                  letter-spacing:0.14em; text-transform:uppercase; margin:0 0 12px; color:var(--an-fg); }
  .fdp-cmts-cap .gt { color:var(--an-green); }
  .fdp-cmts-cap .n { color:var(--an-fg-mute); }
  /* one comment card — the mobile CommentThreadList idiom */
  .fdc { padding:12px 0; border-top:1px solid var(--an-line); }
  .fdc:first-of-type { border-top:none; }
  .fdc-top { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .fdc-ava { width:22px; height:22px; overflow:hidden; flex:none; border:1px solid var(--an-line); }
  .fdc-ava svg { width:100%; height:100%; display:block; }
  .fdc-wallet { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; color:var(--an-fg); }
  .fdc-date { margin-left:auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:9px; color:var(--an-fg-mute); }
  .fdc-to { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px; margin:0 0 4px; color:var(--an-fg-mute); }
  .fdc-text { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.6;
              color:var(--an-fg); white-space:pre-wrap; word-break:break-word; }
  .fdc-replybtn { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:9px; font-weight:700;
                  letter-spacing:0.14em; text-transform:uppercase; margin-top:8px; color:var(--an-fg-mute);
                  background:none; border:none; padding:0; cursor:pointer; }
  .fdc-replies { margin-top:12px; margin-left:16px; padding-left:12px; border-left:1px solid var(--an-line);
                 display:flex; flex-direction:column; gap:12px; }
  .fdc-replies .fdc { border-top:none; padding:0; }
  /* composer: fields + a right-aligned [sage] toggle + the green bracket button */
  .fdp-compose { display:flex; flex-direction:column; gap:10px; margin-top:12px; }
  .fdp-compose-foot { display:flex; align-items:center; justify-content:flex-end; gap:12px; }
  .fd-sage { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px; font-weight:700;
             letter-spacing:0.08em; text-transform:uppercase; color:var(--an-fg-mute);
             background:none; border:none; padding:0; cursor:pointer; }
  .fd-sage.on { color:var(--an-amber); }
  /* on-chain quote card: ">>note:<wallet>:<ts>:<rand>" refs hydrated from chain */
  .fd-qref { color:var(--an-green); opacity:.85; word-break:break-all; }
  .fd-quote { border:1px solid var(--an-line); padding:10px 12px; margin-top:10px;
              font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .fd-quote.fdq-live { cursor:pointer; }
  .fd-quote.fdq-live:hover { border-color:var(--an-green-line); }
  .fd-quote.fdq-loading { color:var(--an-fg-mute); font-size:10px; letter-spacing:0.06em; text-transform:uppercase; }
  .fd-quote.fdq-dead { color:var(--an-fg-mute); font-size:11px; word-break:break-all; }
  .fdq-top { display:flex; align-items:baseline; gap:8px; margin-bottom:4px;
             font-size:10px; color:var(--an-fg-mute); }
  .fdq-when { margin-left:auto; font-size:9px; white-space:nowrap; }
  .fdq-title { font-size:11px; font-weight:700; text-transform:uppercase;
               letter-spacing:0.04em; line-height:1.4; margin:0; color:var(--an-fg); }
  .fdq-snip { font-size:11px; line-height:1.5; margin-top:4px; color:var(--an-fg-mute);
              white-space:pre-wrap; word-break:break-word;
              display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .fdp-gate { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px; letter-spacing:0.06em;
              text-transform:uppercase; border:1px solid var(--an-line); padding:10px 12px; color:var(--an-fg-mute); }
  .fdp-gate .gt { color:var(--an-green); }
  .fdp-gate b { color:var(--an-fg); font-weight:400; text-transform:none; letter-spacing:0; }
  /* bracket FAB (mobile compose FAB): fixed bottom-right, green ticks + green plus */
  .fd-fab { position:fixed; right:18px; bottom:18px; z-index:40; width:48px; height:48px;
            display:flex; align-items:center; justify-content:center; cursor:pointer; border:none;
            background:
              linear-gradient(var(--an-green),var(--an-green)) left top/11px 1.5px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) left top/1.5px 11px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) right top/11px 1.5px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) right top/1.5px 11px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) left bottom/11px 1.5px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) left bottom/1.5px 11px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) right bottom/11px 1.5px no-repeat,
              linear-gradient(var(--an-green),var(--an-green)) right bottom/1.5px 11px no-repeat,
              var(--an-bg-1);
            box-shadow:0 0 14px rgba(0,0,0,0.5); color:var(--an-green);
            font-size:24px; line-height:1; font-weight:400; }
  .fd-fab:hover { box-shadow:0 0 18px rgba(74,222,128,0.18); }
  /* GitHub verified-work registration (own profile): entry button + modal form */
  .pr-repo-add { display:inline-flex; align-items:center; gap:6px; margin:0 0 12px; background:transparent;
                 border:1px solid var(--an-green-line); color:var(--an-green); border-radius:var(--an-radius);
                 padding:7px 13px; font-size:0.82em; font-weight:600; cursor:pointer; }
  .pr-repo-add:hover { background:var(--an-green-dim); }
  .rr-title { font-size:1.1em; font-weight:700; margin-bottom:10px; }
  .rr-hint { opacity:0.7; font-size:0.85em; line-height:1.5; margin-bottom:10px; }
  .rr-input { width:100%; box-sizing:border-box; padding:8px 10px; margin-bottom:8px; background:#0d0d10;
              color:#e8e8ea; border:1px solid #2a2a30; border-radius:4px; outline:none;
              font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.86em; }
  .rr-input:focus { border-color:var(--an-green-line); }
  .rr-input::placeholder { color:#5a5a5d; }
  .rr-link { display:inline-block; margin-bottom:10px; font-size:0.8em; color:var(--an-green); text-decoration:none; }
  .rr-link:hover { text-decoration:underline; }
  .rr-sublabel { font-size:0.72em; text-transform:uppercase; letter-spacing:0.05em; opacity:0.5; margin:6px 0; }
  .rr-skills { display:flex; flex-direction:column; gap:4px; max-height:180px; overflow:auto; margin-bottom:10px; }
  .rr-skill { display:flex; align-items:center; gap:8px; font-size:0.86em; cursor:pointer; }
  .rr-skill input { accent-color:var(--an-green); }
  .rr-err { color:#e05252; font-size:0.82em; margin-bottom:8px; display:none; }
  .rr-btn { width:100%; box-sizing:border-box; text-align:center; background:var(--an-green-dim);
            border:1px solid var(--an-green-line); color:var(--an-green); border-radius:var(--an-radius);
            padding:8px 14px; font-size:0.9em; font-weight:600; cursor:pointer; }
  .rr-btn:hover { background:var(--an-green-line); }
  .rr-btn:disabled { opacity:0.5; cursor:default; }
  .pr-empty { opacity:0.5; font-size:0.85em; padding:10px 2px; }
  /* a skill card in the profile — same language as the market .mktCard */
  .pr-skill { display:flex; align-items:center; gap:12px; padding:10px 12px; margin-bottom:8px;
              border:1px solid var(--an-line); border-radius:var(--an-radius); background:var(--an-bg);
              transition:border-color .12s; }
  .pr-skill .ps-img { width:36px; height:36px; border-radius:8px; background:var(--an-green-dim); flex:none;
                      display:flex; align-items:center; justify-content:center; }
  .pr-skill .ps-img .wand { width:22px; height:auto; color:var(--an-green); display:inline-flex; }
  .pr-skill .ps-img .wand svg { width:100%; height:auto; }
  .pr-skill .ps-main { flex:1; min-width:0; cursor:pointer; }
  .pr-skill .ps-name { font-weight:600; font-size:0.92em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pr-skill .ps-desc { opacity:0.6; font-size:0.82em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pr-skill:hover { border-color:var(--an-green-line); }
  .pr-skill:hover .ps-name { color:var(--an-green); }
  .pr-skill .ps-price { color:var(--an-green); font-size:0.8em; font-weight:600; white-space:nowrap; }
  .pr-skill .mc-buy { background:var(--an-green-dim); border:1px solid var(--an-green-line); color:var(--an-green);
                      border-radius:999px; padding:5px 14px; font-size:0.82em; font-weight:600; cursor:pointer; white-space:nowrap; }
  .pr-skill .mc-buy[disabled] { opacity:0.5; cursor:default; }
  /* skill popup overlay (reuses .dt-* styles for its body) */
  .skModal { position:fixed; inset:0; z-index:60; background:rgba(0,0,0,0.5);
             display:flex; align-items:center; justify-content:center; padding:24px; }
  .skModal-card { position:relative; width:100%; max-width:480px; max-height:82vh; overflow:auto;
                  background:var(--vscode-editor-background); border:1px solid var(--an-line);
                  border-radius:var(--an-radius); padding:20px 18px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.4); }
  .skModal-close { position:absolute; top:10px; right:10px; width:26px; height:26px; line-height:1;
                   background:transparent; border:1px solid transparent; border-radius:6px; color:var(--vscode-foreground);
                   opacity:0.55; cursor:pointer; font-size:13px; }
  .skModal-close:hover { opacity:1; background:var(--an-bg-1); border-color:var(--an-line); }
  #skillModalBody .dt-buy { width:100%; box-sizing:border-box; text-align:center; }
  /* equipped-skill doc popup body (rendered markdown from local SKILL.md) */
  #skillModalBody .skDoc-name { font-size:1.15em; font-weight:700; margin-bottom:10px; }
  #skillModalBody .skDoc-empty { opacity:0.6; font-size:0.86em; padding:8px 0; }
  #skillModalBody .skDoc-body { font-size:0.86em; line-height:1.55; max-height:62vh; overflow:auto; }
  #skillModalBody .skDoc-body h1 { font-size:1.2em; margin:0.6em 0 0.3em; }
  #skillModalBody .skDoc-body h2 { font-size:1.05em; margin:0.8em 0 0.3em; }
  #skillModalBody .skDoc-body h3 { font-size:0.95em; margin:0.7em 0 0.3em; }
  #skillModalBody .skDoc-body p { margin:0.45em 0; }
  #skillModalBody .skDoc-body ul, #skillModalBody .skDoc-body ol { margin:0.45em 0; padding-left:1.4em; }
  #skillModalBody .skDoc-body li { margin:0.15em 0; }
  #skillModalBody .skDoc-body code { font-family:var(--vscode-editor-font-family,monospace); font-size:0.92em;
      background:var(--an-bg); border:1px solid var(--an-line); border-radius:4px; padding:0 4px; }
  #skillModalBody .skDoc-body pre { background:var(--an-bg); border:1px solid var(--an-line);
      border-radius:var(--an-radius); padding:10px 12px; overflow:auto; }
  #skillModalBody .skDoc-body pre code { border:0; padding:0; background:none; }

  /* ── make-skill: topbar/header/panel entry buttons + publish form ── */
  .mktMake { margin-left: auto; background: var(--an-green-dim); color: var(--an-green);
             border: 1px solid var(--an-green-line); border-radius: var(--an-radius);
             padding: 3px 10px; font-size: 0.8em; cursor: pointer; white-space: nowrap; }
  .mktMake:hover { background: var(--an-green-line); }
  .pubForm { display: flex; flex-direction: column; }
  .pubLabel { font-size: 0.8em; font-weight: 600; margin: 12px 0 4px; color: var(--vscode-foreground); }
  .pubLabel .req { color: #8b5cf6; margin-left: 2px; }
  .pubForm input[type=text], .pubForm textarea {
    width: 100%; box-sizing: border-box; padding: 8px 10px; background: #0d0d10;
    color: #e8e8ea; border: 1px solid #2a2a30; outline: none;
    border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.84em; resize: vertical; }
  .pubForm input[type=text]:focus, .pubForm textarea:focus { border-color: #8b5cf6; }
  .pubForm input[type=text]::placeholder, .pubForm textarea::placeholder { color: #5a5a5d; }
  .pubForm textarea { line-height: 1.5; }
  /* workflow builder: skill/workflow toggle + owned-skill picker. A workflow IS the skills
     it requires (the on-chain gate), so workflow mode swaps the SKILL.md box for a checklist.
     Skill keeps the violet publish accent; workflow takes amber. */
  .pubKind { display: flex; gap: 8px; margin: 2px 0 8px; }
  .pubKind button { background: transparent; border: 1px solid #2a2a2e; border-radius: 0; color: #7a7a7f;
                    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 700;
                    letter-spacing: 1.2px; text-transform: uppercase; padding: 6px 14px; cursor: pointer; }
  .pubKind button[data-k=skill].on { border-color: #8b5cf6; color: #c9b6ff; background: rgba(139,92,246,0.12); }
  .pubKind button[data-k=workflow].on { border-color: #f0913e; color: #f3b483; background: rgba(240,145,62,0.12); }
  .pubReq { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto;
            border: 1px solid #1d1d20; border-radius: 0; padding: 8px; background: #0d0d10; }
  .pubReq label { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.86em; color: #cfcfcf; }
  .pubReq .empty { color: #5a5a5d; font-size: 0.82em; }
  .pubReqCount { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72em; color: #7a7a7f; margin-top: 5px; }
  .pubForm.wf input[type=text]:focus, .pubForm.wf textarea:focus { border-color: #f0913e; }
  .pubForm.wf .pubSubmit { --acc: #f0913e; --ink: #1a0f03; }
  .pubHint { font-size: 0.76em; opacity: 0.55; margin-top: 4px; }
  /* on-chain badge — mirrors iq-wide-web's OnChainBadge (◆ ON-CHAIN) */
  .pubBadge { display: inline-block; margin-top: 6px; font-size: 0.7em; font-weight: 700;
              letter-spacing: 0.04em; color: var(--an-green); border: 1px solid var(--an-green-line);
              background: var(--an-green-dim); border-radius: 999px; padding: 2px 8px; }
  .pubError { color: #e05252; font-size: 0.82em; margin-top: 10px; }
  .pubSubmit { margin-top: 16px; align-self: flex-start; background: var(--an-green, #3fa37a);
               color: #06231a; font-weight: 700; border: none; border-radius: var(--an-radius);
               padding: 8px 20px; cursor: pointer; font-size: 0.92em; }
  .pubSubmit:disabled { opacity: 0.5; cursor: default; }

  /* ── SYSTEM // COMMON BUTTON applied to the live market/form action buttons.
     Restyled in place (selectors kept so JS hooks and specificity hold): transparent
     body + shared corner ticks (--an-ticks) + accent fill. Publish takes the violet
     accent; the rest stay green. Layout-only props on the originals (margin, align-self)
     survive since this block does not set them. */
  #mktSearchBtn, #mktDetailBody .dt-buy, #skillModalBody .dt-buy, #mktDetailBody .dt-note-input .dt-note-submit,
  .pr-buyall, .pr-compose button, .pubSubmit {
    --acc: #4ade80; --ink: #06140c;
    position: relative; isolation: isolate; display: inline-flex; align-items: center; justify-content: center;
    gap: 6px; padding: 7px 13px; border: 0; background: transparent; border-radius: 0; cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; font-size: 10px;
    letter-spacing: 1px; text-transform: uppercase; color: var(--ink); white-space: nowrap; transition: opacity 0.12s; }
  #mktSearchBtn::before, #mktDetailBody .dt-buy::before, #skillModalBody .dt-buy::before, #mktDetailBody .dt-note-input .dt-note-submit::before,
  .pr-buyall::before, .pr-compose button::before, .pubSubmit::before {
    content: ""; position: absolute; inset: 0; z-index: -2; background: var(--an-ticks); }
  #mktSearchBtn::after, #mktDetailBody .dt-buy::after, #skillModalBody .dt-buy::after, #mktDetailBody .dt-note-input .dt-note-submit::after,
  .pr-buyall::after, .pr-compose button::after, .pubSubmit::after {
    content: ""; position: absolute; inset: 4px; z-index: -1; background: var(--acc); }
  #mktSearchBtn:hover, #mktDetailBody .dt-buy:hover, #skillModalBody .dt-buy:hover, .pr-buyall:hover, .pr-compose button:hover,
  #mktDetailBody .dt-note-input .dt-note-submit:hover, .pubSubmit:hover { opacity: 0.92; background: transparent; }
  #mktSearchBtn:disabled, #mktDetailBody .dt-buy[disabled], #skillModalBody .dt-buy[disabled], .pr-buyall:disabled,
  #mktDetailBody .dt-note-input .dt-note-submit[disabled], .pubSubmit:disabled { opacity: 0.4; cursor: default; }
  .pubSubmit { --acc: #8b5cf6; --ink: #0c0618; }

  /* ---- COMPLETE overlay: a green LED dot-matrix plaque that pops in on a success
       (buy / publish / comment / GitHub register), then auto-fades. Design "OVERLAY //
       COMPLETE" — one plaque; only the [CONTEXT] sub-label swaps. Literal design green
       (not a theme var) so the LED reads the same in every VS Code theme. ---- */
  #celebrate { position: fixed; inset: 0; z-index: 999; display: none; align-items: center;
               justify-content: center; cursor: pointer;
               background: rgba(6,9,11,0.74); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
  #celebrate.show { display: flex; animation: cmpFade 0.24s ease; }
  #celebrate.out { animation: cmpFadeOut 0.4s ease forwards; }
  .cmpWrap { display: flex; flex-direction: column; align-items: center; padding: 0 16px;
             animation: cmpPop 0.5s cubic-bezier(0.18,0.9,0.28,1.3); }
  /* outer bezel: green frame + outer glow over a dark inset */
  .cmpPlaque { border: 3px solid #46e06a; border-radius: 6px; padding: 6px; background: #0a140c;
               box-shadow: 0 0 30px rgba(70,224,106,0.5), inset 0 0 14px rgba(70,224,106,0.22); }
  /* inner LED panel: bright green with a dot-matrix radial texture */
  .cmpLed { position: relative; overflow: hidden; background: #46e06a;
            padding: 12px clamp(20px, 7vw, 46px); }
  .cmpLed::before { content: ''; position: absolute; inset: 0;
                    background-image: radial-gradient(rgba(4,20,8,0.5) 1.1px, transparent 1.2px);
                    background-size: 5px 5px; }
  .cmpLed span { position: relative; display: block; line-height: 1; color: #06180b;
                 letter-spacing: 0.07em; font-weight: 900; font-size: clamp(34px, 11vw, 58px);
                 font-family: 'Doto', ui-monospace, SFMono-Regular, Menlo, monospace; }
  .cmpLabel { margin-top: 18px; text-align: center; color: #6fbf88; letter-spacing: 0.18em;
              font-weight: 700; font-size: clamp(12px, 3.4vw, 17px);
              font-family: 'Doto', ui-monospace, SFMono-Regular, Menlo, monospace;
              animation: cmpRise 0.5s ease 0.1s both; }
  @keyframes cmpFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes cmpFadeOut { to { opacity: 0; } }
  @keyframes cmpPop { 0% { transform: scale(0.4); opacity: 0; }
                      60% { transform: scale(1.12); }
                      100% { transform: scale(1); opacity: 1; } }
  @keyframes cmpRise { 0% { transform: translateY(8px); opacity: 0; }
                       100% { transform: translateY(0); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .cmpWrap, .cmpLabel { animation-duration: 0.01ms; }
  }

  /* ---- wallet balance (dropdown) + market balance chip ---- */
  /* balance block, right-aligned in the wallet header: tiny caption over the SOL amount */
  .walletBal { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end;
               gap: 1px; text-align: right; white-space: nowrap; }
  .walletBal .balLabel { font-size: 0.6em; text-transform: uppercase; letter-spacing: 0.08em;
                         opacity: 0.45; font-weight: 700; }
  .walletBal .balAmt { font-size: 0.98em; font-weight: 600; color: var(--an-green);
                       display: flex; align-items: center; gap: 4px; }
  .walletBal .balAmt::before { content: '◎'; opacity: 0.8; font-weight: 400; } /* SOL glyph */
  .walletBal.low .balAmt { color: var(--an-amber); }
  .mktTitleRow { display: flex; align-items: center; gap: 10px; }
  .mktBal { font-size: 0.82em; font-weight: 600; color: var(--an-green); white-space: nowrap;
            padding: 2px 9px; border-radius: 999px; border: 1px solid var(--an-green-line);
            background: var(--an-green-dim); display: inline-flex; align-items: center; gap: 4px; }
  .mktBal::before { content: '◎'; opacity: 0.85; font-weight: 400; }
  .mktBal.low { color: var(--an-amber); border-color: color-mix(in srgb, var(--an-amber) 45%, transparent);
                background: color-mix(in srgb, var(--an-amber) 10%, transparent); }

  /* ---- buy-failure banner: orange-bordered box with an (i) icon (issue: buy errors) ---- */
  #buyErr { position: fixed; left: 50%; transform: translateX(-50%) translateY(-8px);
            top: 14px; z-index: 1000; max-width: min(460px, 90vw); display: none;
            opacity: 0; transition: opacity 0.2s ease, transform 0.2s ease; }
  #buyErr.show { display: block; opacity: 1; transform: translateX(-50%) translateY(0); }
  .buyErrBox { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px;
               border-radius: var(--an-radius-sm); border: 1px solid var(--an-amber);
               background: color-mix(in srgb, var(--an-amber) 12%, var(--an-bg));
               box-shadow: 0 6px 22px rgba(0,0,0,0.35); }
  .buyErrIcon { flex: none; width: 18px; height: 18px; border-radius: 50%; margin-top: 1px;
                border: 1.5px solid var(--an-amber); color: var(--an-amber); font-weight: 700;
                font-size: 0.8em; font-style: italic; display: flex; align-items: center;
                justify-content: center; font-family: Georgia, serif; }
  .buyErrText { flex: 1; min-width: 0; font-size: 0.86em; line-height: 1.4; color: var(--an-fg); }
  .buyErrText .t { font-weight: 600; color: var(--an-amber); display: block; margin-bottom: 1px; }
  .buyErrText .m { opacity: 0.85; word-break: break-word; }
  .buyErrClose { flex: none; background: none; border: none; color: var(--an-fg); opacity: 0.5;
                 cursor: pointer; font-size: 1.1em; line-height: 1; padding: 0 2px; }
  .buyErrClose:hover { opacity: 1; }
  /* devnet fund action inside the buy-error banner (insufficient_funds only) */
  .buyErrFund { display: inline-block; margin-top: 7px; background: color-mix(in srgb, var(--an-amber) 18%, transparent);
                border: 1px solid var(--an-amber); color: var(--an-amber); border-radius: var(--an-radius-sm);
                padding: 4px 12px; font-size: 0.92em; font-weight: 600; cursor: pointer; }
  .buyErrFund:hover { background: color-mix(in srgb, var(--an-amber) 28%, transparent); }
  .buyErrFund:disabled { opacity: 0.6; cursor: default; }
</style>
</head>
<body>
  <!-- COMPLETE overlay: green LED plaque, filled + shown by showComplete on a success -->
  <div id="celebrate"></div>
  <!-- buy-failure banner (orange-bordered, (i) icon) — filled + shown by showBuyError -->
  <div id="buyErr" class="buyErr" style="display:none"></div>
  <!-- skill popup: opened from a profile skill card; reuses the .dt-* detail styles -->
  <div id="skillModal" class="skModal" style="display:none">
    <div class="skModal-card">
      <button class="skModal-close" id="skillModalClose" title="Close" aria-label="Close">✕</button>
      <div id="skillModalBody"></div>
    </div>
  </div>
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
    <button id="marketsBtn" title="Skill marketplace">Markets</button>
    <button id="agentsBtn" title="Blog feed + agent directory">AgentNet</button>
    <div class="spacer"></div>
    <button id="histBtn" title="Recent chats" aria-label="Recent chats"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.8"></circle><path d="M8 4.8v3.2l2.3 1.4"></path></svg></button>
    <button id="newTabBtn" title="Open another chat in a new tab"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.2v9.6M3.2 8h9.6"></path></svg></button>
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
      <!-- balance pinned to the right of the header: a small caption + the SOL amount -->
      <div id="wBalance" class="walletBal" style="display:none">
        <span class="balLabel">balance</span>
        <span class="balAmt"></span>
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
    <!-- RPC (issue #23): a Helius key powers the marketplace (DAS); the default can't.
         Always shows status here so a user can add/swap the key after onboarding. -->
    <div class="wmSection">
      <div class="wmLabel">RPC</div>
      <div class="wmStorage">
        <span id="rpcState" class="muted">…</span>
        <button id="rpcSetBtn" class="link">Set Helius key</button>
        <button id="rpcDefaultBtn" class="link" style="display:none">Use default</button>
      </div>
      <div id="rpcHint" class="muted small" style="display:none;margin-top:3px"></div>
    </div>
    <div class="wmItem" id="openWalletPage">Wallet page</div>
    <div class="wmItem" id="walletSkills"><span class="wand">${WAND_SVG}</span> Skills <span class="soon" id="walletSkillCount" style="display:none"></span><span class="wmCaret" id="walletSkillCaret">▸</span></div>
    <!-- inline, scrollable list of the skills THIS wallet owns. No buy / no navigation —
         purchases happen in the Markets tab. Just "what do I own", scroll through it. -->
    <div id="walletSkillList" style="display:none"></div>
    <!-- same action as the profile page's Disconnect button; lives here too because the
         dropdown is where storage/RPC connections are managed, so it's where users look -->
    <div class="wmItem wmDanger" id="walletDisconnect">Disconnect wallet</div>
  </div>

  <div id="wrap">
    <div id="main">
      <!-- faint IQ watermark, shown only on an empty (new) chat -->
      <div id="watermark">${IQ_LOGO_SVG}</div>
      <!-- loading veil shown while a session is being carried to the other engine -->
      <div id="loading" style="display:none"><div class="spin"></div><span>Resuming…</span></div>
      <div id="logWrap">
        <div id="log"></div>
        <button id="jumpBtn" type="button" data-cli="claude" title="Jump to latest" aria-label="Jump to latest"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 8 10.5l4-4"/></svg></button>
      </div>
      <!-- pending tool approvals dock just above the composer (Claude-Code style:
           "the thing you must answer" sits right where you'd reply) -->
      <div id="approvalDock"></div>
      <!-- engine-update banner: persistent + dismissible, a SIBLING of the log so a
           chat repaint (which clears #log and #approvalDock) never wipes it. This is
           what fixed the "update flashes on every new chat, cannot be clicked" bug. -->
      <div id="engineBanner" style="display:none"></div>
      <!-- equipped-skills panel (toggled by #skillsBtn) — the agent's "magic items".
           Real now: a header + empty grey slots that say drops aren't live yet. -->
      <!-- inventory-only panel: shows just the skills THIS wallet owns (on-chain is the
           source of truth). Buying moved to the full Markets view; the SHOP button below
           opens it instead of duplicating a search box here. -->
      <div id="skillsPanel" style="display:none">
        <div class="skHead">
          <span class="skTitle">SKILLS</span>
          <span class="skMuted" id="skillStatus">0</span>
          <button id="skillsClose" title="Close">×</button>
        </div>
        <div id="skillGrid">
          <!-- coming-soon grey slots (no lie: nothing equipped yet) -->
          <div class="skSlot empty"></div>
          <div class="skSlot empty"></div>
          <div class="skSlot empty"></div>
        </div>
        <div class="skDivider"></div>
        <div id="skillsFooter">
          <div class="skActions">
            <button id="panelMakeSkillBtn" class="skBtn skBtn-pub" title="Publish a new skill">+ PUBLISH</button>
            <button id="panelShopBtn" class="skBtn skBtn-shop" title="Browse the marketplace">SHOP ›</button>
          </div>
          <!-- passive skill-shopping toggle (issue #21): ON = the agent shops for a missing
               capability (verify → confirm → buy); OFF = owned-only, never buys. -->
          <div class="skShopForMe">
            <span class="sfm-label">›SHOP_FOR_ME <span class="sfm-q">[?]</span><span class="sfm-tip">agent buys skills it needs, with your OK</span></span>
            <button id="shopToggle" role="switch" aria-checked="true" class="on" title="Toggle passive skill-shopping"><span class="knob"></span></button>
          </div>
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
          <div id="slashMenu" class="slashMenu" style="display:none"></div>
          <!-- attached-image thumbnails (hidden until you add one). Each has an × to remove. -->
          <div id="attachStrip" style="display:none"></div>
          <textarea id="input" rows="1" placeholder="Message claude... (Enter to send)"></textarea>
          <div id="controls">
            <button id="attachBtn" title="Attach image">${PAPERCLIP_SVG}</button>
            <input type="file" id="fileInput" accept="image/*" multiple hidden />
            <span id="modelWrap">
              <button id="modelBtn" title="Model: which model this engine runs">
                <span class="mglyph">◇</span><span id="modelLabel">model</span><span class="mcaret">▾</span>
              </button>
              <div id="modelMenu" style="display:none"></div>
            </span>
            <span id="modeWrap">
              <button id="modeBtn" title="How tools run before asking you, and how deeply the model thinks">
                <span id="modeLabel">mode</span><span id="modeEffortTag"></span><span class="mcaret">▾</span>
              </button>
              <div id="modeMenu" style="display:none"></div>
            </span>
            <span id="ctxMeter" style="display:none"></span>
            <span id="limitMeter" style="display:none"><span class="lm-track"><span class="lm-fill"></span></span><span class="lm-pct"></span></span>
            <button id="send" title="Send" aria-label="Send"><svg class="ic-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg><svg class="ic-stop" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg><span class="lbl">Send</span></button>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div><!-- /chatView -->

  <!-- AGENT PROFILE view — shared renderer for own wallet + other agents.
       Storage/Disconnect are own-only (profileSelf flag hides them when browsing others).
       #profileBody is filled by renderProfile() from the agentProfile message. -->
  <div id="walletView" class="panel" style="display:none">
    <div class="page">
      <div id="backToChat" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
      <!-- hero: the mobile .an-id ID card (tier ladder + stars gauge). Verified work now
           lives inside the Agent tab (below), matching the mobile profile layout. -->
      <div id="agentIdCard"></div>
      <!-- hidden compat stubs: showProfile + the wallet-sync handler still set these shared ids -->
      <div style="display:none">
        <span id="wAvatarBig"></span><span id="walletAddr"></span>
        <span id="profileSubtitle"></span><span id="profileRep"></span>
      </div>
      <div id="profileBody"></div>
      <div id="profileSelfOnly2">
        <button class="danger" id="disconnectWalletBtn">Disconnect wallet</button>
        <div class="muted small">Disconnecting returns you to the connect screen. Your encrypted local sessions stay on this device.</div>
      </div>
    </div>
  </div>

  <!-- AGENTNET view (issue #210) — FEED (global blog feed, default) + RANK (agent directory) -->
  <div id="agentsView" class="panel" style="display:none">
    <div class="page">
      <div id="backToChatA" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
      <div class="pr-tabs" id="agSubTabs">
        <button class="pr-tab on" id="agTabFeed" type="button"><div class="t">Feed</div></button>
        <button class="pr-tab" id="agTabRank" type="button"><div class="t">Rank</div></button>
      </div>
      <!-- FEED: compact preview rows over the feed:blog anchor, ACTIVE | LATEST sort -->
      <div id="agFeedPane">
        <div class="fd-head">
          <span class="fd-cap">&gt;GLOBAL_BLOG_FEED</span>
          <div class="fd-sort">
            <button id="fdSortActive" class="on" type="button">Active</button>
            <button id="fdSortLatest" type="button">Latest</button>
          </div>
        </div>
        <div id="feedList"></div>
        <!-- compose FAB (mobile parity): write a blog post from the feed -->
        <button id="fdFab" class="fd-fab" title="Write a blog post" style="display:none">+</button>
      </div>
      <!-- FEED post reader: body + comment thread + sage composer (swaps in over the list) -->
      <div id="agFeedPost" style="display:none"></div>
      <!-- RANK: the ranked agent directory (by totalSupply), unchanged -->
      <div id="agRankPane" style="display:none">
        <!-- sticky: your own agent card + wallet search, pinned while the ranked list scrolls under -->
        <div class="agSticky">
          <div id="agentsSelf"></div>
          <div class="agSearch">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a7a7a" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.5-4.5"/></svg>
            <input id="agentSearch" type="text" placeholder="Search agent wallet…" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
          </div>
        </div>
        <div id="agentsList" class="agList"></div>
      </div>
    </div>
  </div>

  <!-- Make skill: author + publish a new skill (mints a Token-2022 soulbound NFT +
       code-in JSON). Opened from the topbar, the market header, or the skills panel. -->
  <div id="publishView" class="panel" style="display:none">
    <div class="page">
      <div id="backToChatP" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
      <div class="mktHead">
        <div class="mktTitle"><span class="wand">${WAND_SVG}</span> <span id="pubViewTitle">Make a skill</span></div>
        <div class="muted small" id="pubViewDesc">Publish a skill others can buy. It mints a soulbound NFT and the body is stored on-chain.</div>
      </div>
      <div class="pubForm" id="pubForm">
        <div class="an-formhead" id="pubFormHead">FORM // <b>PUBLISH SKILL</b></div>
        <div class="pubKind">
          <button data-k="skill" class="on">Skill</button>
          <button data-k="workflow">Workflow</button>
        </div>
        <label class="pubLabel">Name<span class="req">*</span></label>
        <input id="pubName" type="text" placeholder="clean-code-refactor" />

        <label class="pubLabel">Description<span class="req">*</span></label>
        <textarea id="pubDesc" rows="2" placeholder="One or two lines on what this skill does."></textarea>

        <label class="pubLabel">Category</label>
        <input id="pubCategory" type="text" placeholder="clean-code (optional)" />

        <label class="pubLabel">Hashtags</label>
        <input id="pubHashtags" type="text" placeholder="refactoring, testing (comma-separated, optional)" />

        <label class="pubLabel">Image</label>
        <input id="pubImage" type="text" placeholder="https://….png  or  on-chain address (optional)" />
        <div id="pubImageBadge" class="pubBadge" style="display:none">◆ ON-CHAIN</div>
        <div class="pubHint">A direct image URL, or an on-chain address. Leave empty for the default art. (Uploading an image on-chain: see the IQLabs SDK at https://x.com/spacebuneth/status/2064477269871960574)</div>

        <div id="pubTextWrap">
        <label class="pubLabel">Skill text<span class="req">*</span></label>
        <textarea id="pubText" rows="10" placeholder="# Skill name&#10;&#10;The SKILL.md body only: what the agent reads when this skill fires.&#10;No --- frontmatter: name & description come from the fields above."></textarea>
        <div class="pubHint">Body only. Don't add a <code>---</code> name/description block; it's built from the fields above.</div>
        </div>
        <div id="pubReqWrap" style="display:none">
        <label class="pubLabel">Required skills<span class="req">*</span></label>
        <div class="pubHint">Pick the skills you own that this workflow combines. Buyers must hold every one to unlock it (max 16).</div>
        <div class="pubReq" id="pubReq"></div>
        <div class="pubReqCount" id="pubReqCount"></div>
        </div>

        <label class="pubLabel">Price (SOL)<span class="req">*</span></label>
        <input id="pubPrice" type="text" value="0.1" placeholder="0.1" />
        <div class="pubHint">What buyers pay to unlock it. Set 0 for a free skill.</div>

        <div id="pubError" class="pubError" style="display:none"></div>
        <button id="pubSubmit" class="pubSubmit">Publish skill</button>
      </div>
    </div>
  </div>

  <!-- Markets: the full-screen skill marketplace (search → results → buy). Reuses the
       shared market message contract; the same screens get a mobile design later. -->
  <div id="marketView" class="panel" style="display:none">
    <div class="page">
      <!-- LIST sub-view: tabs (Skills/Workflows) + search + grid -->
      <div id="mktList">
        <div id="backToChatM" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
        <div class="mktHead">
          <div class="mktTitleRow">
            <div class="mktTitle"><span class="wand">${WAND_SVG}</span> Skill Market</div>
            <span id="mktBalance" class="mktBal" title="Your wallet balance" style="display:none"></span>
            <button id="mktMakeSkillBtn" class="mktMake" title="Publish a new skill">＋ Make skill</button>
          </div>
          <div class="muted small">Popular first. Buy an item (soulbound) and your agent equips it.</div>
        </div>
        <div class="mktTabRow">
          <div class="mktTabs">
            <button class="mktTab on" data-kind="skill">Skills</button>
            <button class="mktTab" data-kind="workflow">Workflows</button>
          </div>
          <label class="mktFilter" title="Hide skills your wallet already owns">
            <input type="checkbox" id="mktHideOwned" /> Hide owned
          </label>
          <button id="mktSortBtn" class="mktSortBtn" title="Sort by popularity or GitHub stars">Popular</button>
        </div>
        <div class="mktSearchRow">
          <input id="mktSearch" type="text" placeholder="Search…" />
          <button id="mktSearchBtn">Search</button>
        </div>
        <div id="mktResults" class="mktGrid"></div>
      </div>
      <!-- DETAIL sub-view: one item's full info (hidden until a card is clicked) -->
      <div id="mktDetail" style="display:none">
        <div id="backToList" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to market</div>
        <div id="mktDetailBody"></div>
      </div>
    </div>
  </div>
<!-- markdown libs (marked + dompurify), inlined; expose window.marked / window.DOMPurify -->
<script>${markdownLibs()}</script>
<script>${PANEL_SCRIPT}</script>
</body>
</html>`;
}
