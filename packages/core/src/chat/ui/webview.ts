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
import { SKILL_SIGIL_SCRIPT } from "./skillSigil.js";
import { IQ_LOGO_SVG } from "./iqlogo.js";
import { MD_LIBS } from "./mdLibs.generated.js";
import { CHAT_MODEL_OPTIONS } from "../modelOptions.js";
import { CHAT_SLASH_COMMANDS } from "../slashCommands.js";

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
const PAPERCLIP_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5l-5.6 5.6a2.5 2.5 0 0 1-3.5-3.5L9 3a1.7 1.7 0 0 1 2.4 2.4l-5.4 5.4a0.85 0.85 0 0 1-1.2-1.2l5-5"/></svg>';
// A stacked-layers glyph — the workflow affordance (a workflow composes several skills),
// distinct from the single-skill wand so workflows read as "crafted/composite" at a glance.
const LAYERS_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l5.8 3L8 7.8 2.2 4.8 8 1.8z"/><path d="M2.2 8L8 11l5.8-3"/><path d="M2.2 11.2L8 14.2l5.8-3"/></svg>';
const MODEL_OPTIONS_JSON = JSON.stringify(CHAT_MODEL_OPTIONS);
const SLASH_COMMANDS_JSON = JSON.stringify(CHAT_SLASH_COMMANDS);

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
<link href="https://fonts.googleapis.com/css2?family=Doto:wght@700;900&display=swap" rel="stylesheet" />
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
  /* Markets: a green-tinted pill next to the wallet — the entry to the marketplace view */
  #marketsBtn { margin-left: 8px; background: var(--an-green-dim); color: var(--an-green);
                border: 1px solid var(--an-green-line); border-radius: 999px; padding: 3px 14px;
                font-size: 0.78em; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  #marketsBtn:hover { background: color-mix(in srgb, var(--an-green) 22%, transparent); }
  #marketsBtn.on { background: var(--an-green); color: #07140d; }
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

  /* equipped-skills panel (above the composer) */
  #skillsPanel { margin: 8px 12px 0; border: 1px solid var(--an-line); border-radius: var(--an-radius);
                 background: var(--vscode-editorWidget-background, var(--an-bg-2)); padding: 10px 12px; }
  #skillsPanel .skHead { display: flex; align-items: center; gap: 7px; font-size: 0.78em;
                         font-weight: 600; opacity: 0.85; margin-bottom: 9px; }
  #skillsPanel .skHead .wand { width: 14px; height: 14px; color: var(--an-green); }
  #skillsPanel .skMuted { margin-left: auto; font-weight: 400; opacity: 0.5; font-size: 0.92em; }
  /* filter toggle: hide the built-in (non-collectible) default skills, keep only owned NFTs */
  #skillsPanel .skFilter { display: inline-flex; align-items: center; gap: 4px; font-weight: 400;
                           opacity: 0.62; cursor: pointer; user-select: none; white-space: nowrap; }
  #skillsPanel .skFilter:hover { opacity: 0.95; }
  #skillsPanel .skFilter input { margin: 0; accent-color: var(--an-green); cursor: pointer; }
  #skillsClose { margin-left: 8px; width: 20px; height: 20px; padding: 0; line-height: 18px; text-align: center;
                 font-size: 15px; border-radius: 5px; background: transparent; color: var(--vscode-foreground);
                 opacity: 0.55; border: 1px solid transparent; cursor: pointer; flex: 0 0 auto; }
  #skillsClose:hover { opacity: 1; background: var(--an-bg-1); border-color: var(--an-line); }
  /* owned-skill grid scrolls once it outgrows ~3 rows instead of pushing the chat up */
  /* responsive: 3 cols in a narrow dock, more as the panel widens (auto-fill packs
     as many ~96px cards as fit). max-height keeps it to ~3 rows then scrolls. */
  #skillGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px;
               max-height: 340px; overflow-y: auto; }
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
  #skillResults { margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px;
                  max-height: 300px; overflow-y: auto; }
  #skillResults .shopEmpty { grid-column: 1 / -1; }
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
                  z-index: 3; opacity: 0.62; mix-blend-mode: overlay; background-size: 64px 64px;
                  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='1.7' intercept='-0.35'/%3E%3CfeFuncG type='linear' slope='1.7' intercept='-0.35'/%3E%3CfeFuncB type='linear' slope='1.7' intercept='-0.35'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E"); }
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
  .an-sd-name { position: absolute; left: 7px; right: 8px; bottom: 38px; z-index: 4;
                font-family: "Space Grotesk", ui-sans-serif, system-ui, sans-serif; font-size: 14.5px; font-weight: 700;
                letter-spacing: -0.2px; color: #ffffff; line-height: 1.1; word-break: break-word;
                text-shadow: 0 1px 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.7);
                display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .an-sd-chip { position: absolute; left: 6px; bottom: 6px; right: 14px; z-index: 4; display: flex;
                align-items: center; gap: 4px; background: var(--chip); padding: 3px 7px; border-radius: 2px;
                box-shadow: inset 0 -1px 0 rgba(0,0,0,0.16); }
  .an-sd-big { font-size: 14px; font-weight: 700; color: #2a0f06; line-height: 1; }
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

  #controls { display: flex; gap: 8px; align-items: center; padding: 4px 8px 7px; font-size: 0.82em; }
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
  /* usage context meter: small text chip near the composer chips */
  #ctxMeter { font-size: 0.82em; opacity: 0.55; display: inline-flex; align-items: center; }
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
  .msgImgs img { max-width: 168px; max-height: 168px; border-radius: 8px; border: 1px solid var(--an-line); display: block; }
  .imgChip { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; padding: 2px 9px;
             font-size: 0.82em; opacity: 0.7; border: 1px solid var(--an-line); border-radius: 999px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; border-radius: 6px; cursor: pointer; }

  /* ── issue #35: agent directory + profile ── */
  #agentsBtn.on { color: var(--an-green); border-bottom: 2px solid var(--an-green); }

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
  .mktMake, .skMake { margin-left: auto; background: var(--an-green-dim); color: var(--an-green);
                      border: 1px solid var(--an-green-line); border-radius: var(--an-radius);
                      padding: 3px 10px; font-size: 0.8em; cursor: pointer; white-space: nowrap; }
  .skMake { margin-left: 0; padding: 2px 8px; font-size: 0.74em; }
  .mktMake:hover, .skMake:hover { background: var(--an-green-line); }
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
    <button id="agentsBtn" title="Agent directory">Agents</button>
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
      <!-- equipped-skills panel (toggled by #skillsBtn) — the agent's "magic items".
           Real now: a header + empty grey slots that say drops aren't live yet. -->
      <div id="skillsPanel" style="display:none">
        <div class="skHead">
          <span class="wand">${WAND_SVG}</span>
          <span>Equipped skills</span>
          <span class="skMuted" id="skillStatus">none active</span>
          <label class="skFilter" title="Hide the built-in default skills, show only owned on-chain skills">
            <input type="checkbox" id="skHideDefault" /> Hide default
          </label>
          <button id="panelMakeSkillBtn" class="skMake" title="Publish a new skill">＋ Make skill</button>
          <button id="skillsClose" title="Close">×</button>
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

  <!-- AGENTS DIRECTORY view — ranked list of agents (by totalSupply) -->
  <div id="agentsView" class="panel" style="display:none">
    <div class="page">
      <div id="backToChatA" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
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
        <textarea id="pubText" rows="10" placeholder="# Skill name&#10;&#10;The SKILL.md body only — what the agent reads when this skill fires.&#10;No --- frontmatter: name & description come from the fields above."></textarea>
        <div class="pubHint">Body only — don't add a <code>---</code> name/description block; it's built from the fields above.</div>
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
<script>
  const AVATAR_SVG = ${JSON.stringify(AVATAR_SVG)};
  ${AVATAR_SCRIPT}
  ${SKILL_SIGIL_SCRIPT}
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
  // SVG copy/check glyphs + clipboard write, used by the per-code-block copy buttons.
  const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 5"/></svg>';
  // Copy text, flashing btn into a check while it lands. execCommand is the fallback
  // for webviews where the async clipboard API is unavailable.
  function copyText(text, btn) {
    const done = () => { btn.classList.add('done'); btn.innerHTML = CHECK_ICON;
      setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = COPY_ICON; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
    else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); done(); } catch (e2) {} document.body.removeChild(ta); }
  }
  // Give every fenced code block its own copy button, revealed on hovering that block.
  // The pre gets wrapped because it scrolls horizontally: anchoring the button to the
  // wrapper keeps it pinned at the top-right instead of sliding away with wide code.
  function addPreCopyButtons(root) {
    const pres = root.querySelectorAll('pre');
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      if (!pre.parentNode || (pre.parentNode.classList && pre.parentNode.classList.contains('preWrap'))) continue;
      const wrap = document.createElement('div');
      wrap.className = 'preWrap';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const btn = document.createElement('button');
      btn.className = 'preCopy'; btn.title = 'Copy code'; btn.innerHTML = COPY_ICON;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = pre.querySelector('code'); // the fence body, without the button
        copyText((code || pre).textContent || '', btn);
      });
      wrap.appendChild(btn);
    }
  }

  // Render md text into el's innerHTML (sanitized). Falls back to textContent if the
  // libs didn't load. We keep the raw md on el.dataset.md so copy yields the source.
  function renderMd(el, text) {
    el.dataset.md = text;
    if (!MD_OK) { el.textContent = text; return; }
    try { el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text)); addPreCopyButtons(el); }
    catch (e) { el.textContent = text; }
  }

  const log = document.getElementById('log');
  const mainEl = document.getElementById('main');
  const loadingEl = document.getElementById('loading');
  // hide the IQ watermark once the chat has any content; show it on an empty log
  function syncWatermark() { mainEl.classList.toggle('hasMsgs', log.childElementCount > 0); }
  function renderNotice(text) {
    const notice = document.createElement('div');
    notice.style.cssText = 'padding:4px 12px;font-size:0.82em;opacity:0.65;white-space:pre-wrap';
    notice.textContent = text;
    log.appendChild(notice); syncWatermark(); stickToBottom();
  }
  function renderStatus(status) {
    const ctx = typeof status.contextTokens === 'number'
      ? (status.contextTokens >= 1000 ? Math.round(status.contextTokens / 1000) + 'k' : String(status.contextTokens))
      : 'unknown';
    const text = [
      'engine: ' + status.cli,
      'session: ' + (status.sessionId || '(none)'),
      'model: ' + (status.model || 'default'),
      'mode: ' + (status.mode || 'default'),
      'effort: ' + (status.effort || 'default'),
      'context tokens: ' + ctx,
    ].join('\\n');
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:8px 0;padding:8px 12px;background:var(--an-bg-1);border-radius:6px;font-size:0.82em;opacity:0.85;white-space:pre-wrap';
    pre.textContent = text;
    log.appendChild(pre); syncWatermark(); stickToBottom();
  }

  // ---- stick-to-bottom + jump-to-latest (normal chat-app feel) ----
  // Follow the newest message ONLY while the user is already near the bottom (a generous
  // threshold, so light scrolling doesn't unpin). Once they scroll up we stop following the
  // stream and reveal a round "down" button (bottom-right of the log) to jump back. The
  // button is visible whenever scrolled up, so a new reply arriving up there is reachable in
  // one click. Programmatic scrolls are forced INSTANT so the 'scroll' listener can't mistake
  // a smooth animation's midpoint for "scrolled away".
  const jumpBtn = document.getElementById('jumpBtn');
  let stick = true;
  let hasNew = false; // new content arrived while scrolled up → light the button in the engine accent
  function nearBottom() {
    const d = log.scrollHeight - log.scrollTop - log.clientHeight;
    return d <= Math.max(180, log.clientHeight * 0.25); // generous "close enough to bottom"
  }
  function toBottomInstant() {
    const prev = log.style.scrollBehavior;
    log.style.scrollBehavior = 'auto'; // bypass CSS smooth so we land exactly at the bottom
    log.scrollTop = log.scrollHeight;
    log.style.scrollBehavior = prev;
  }
  function updateJump() {
    if (!jumpBtn) return;
    if (stick) hasNew = false;           // back at the bottom → nothing new to catch up on
    jumpBtn.classList.toggle('show', !stick);
    jumpBtn.classList.toggle('hasNew', hasNew); // engine-tinted (claude=orange / codex=green) when unread
  }
  function stickToBottom() {              // auto-scroll only if pinned; otherwise flag unread
    if (stick) toBottomInstant(); else hasNew = true;
    updateJump();
  }
  function scrollToLatest() { stick = true; hasNew = false; toBottomInstant(); updateJump(); } // force (new command / button)
  if (jumpBtn) jumpBtn.addEventListener('click', scrollToLatest);

  // loading veil while a session is carried to the other engine (cross-CLI switch)
  function showLoading() { loadingEl.style.display = 'flex'; }
  function hideLoading() { loadingEl.style.display = 'none'; }
  const input = document.getElementById('input');
  const sessList = document.getElementById('sessList');
  const showAll = document.getElementById('showAll');
  const emptyEl = document.getElementById('empty');
  const modelBtn = document.getElementById('modelBtn');
  const modelMenu = document.getElementById('modelMenu');
  const modelLabel = document.getElementById('modelLabel');
  const composer = document.getElementById('composer');
  const modeBtn = document.getElementById('modeBtn');
  const modeMenu = document.getElementById('modeMenu');
  const modeLabel = document.getElementById('modeLabel');
  const modeEffortTag = document.getElementById('modeEffortTag');
  const ctxMeter = document.getElementById('ctxMeter');
  const approvalDock = document.getElementById('approvalDock');
  const slashMenu = document.getElementById('slashMenu');
  const tabs = Array.from(document.querySelectorAll('.etab'));

  let streaming = null;     // bubble currently being streamed into
  let streamRaf = 0;        // rAF handle: coalesces live-markdown renders to one paint/frame
  // Reuse renderMd so the assistant's reply renders AS MARKDOWN while it streams, instead of
  // raw source that only formats once the turn completes. Throttled via rAF so a fast token
  // stream stays smooth (thinking text stays plain).
  function flushStreamRender() {
    streamRaf = 0;
    if (!streaming) return;
    const raw = streaming.dataset.acc || '';
    if (streaming.dataset.role === 'assistant') renderMd(streaming, raw);
    else { streaming.textContent = raw; streaming.dataset.md = raw; }
    // Follow the tail + keep the typing indicator pinned to the bottom HERE, coalesced to
    // this frame. Doing it per streamed snapshot forced a synchronous layout (scrollHeight
    // read) on every token and was a top cause of editor-wide jank while streaming.
    if (typingEl) tailBody().appendChild(typingEl);
    stickToBottom();
  }
  function scheduleStreamRender() { if (!streamRaf) streamRaf = requestAnimationFrame(flushStreamRender); }
  let allSessions = [];     // last sessions payload from extension
  let cloudListState = 'none'; // cloud health of that payload's union (ok/reauth/transient/none)
  let activeId = null;
  let expanded = false;     // "모두 보기" toggled?
  const COLLAPSED = 5;      // sessions shown before "모두 보기(N)"

  // ---- slash command autocomplete ----
  const SLASH_CMDS = ${SLASH_COMMANDS_JSON}.map(function(c) {
    return Object.assign({}, c, { insert: '/' + c.name + (c.args ? ' ' : '') });
  });
  function slashCommandsForCli() {
    return SLASH_CMDS.filter(function(cmd) {
      return !cmd.engines || cmd.engines.indexOf(cli) >= 0;
    });
  }
  let slashIdx = 0;
  let suppressSlash = false;
  let activeSlashMatches = [];

  function renderSlashMenu() {
    if (suppressSlash) {
      slashMenu.style.display = 'none';
      activeSlashMatches = [];
      return;
    }
    const val = input.value;
    
    // Check if it matches a sub-command argument first
    let subCmd = null;
    let prefix = '';
    let options = [];

    // 1. Engine options
    let m = /^\\/engine(?:\\s+(\\S*))?$/.exec(val);
    if (m) {
      subCmd = 'engine';
      prefix = (m[1] || '').toLowerCase();
      options = [
        { name: 'claude', desc: 'switch to Claude engine', insert: '/engine claude' },
        { name: 'codex',  desc: 'switch to Codex engine',  insert: '/engine codex' }
      ];
    }
    // 2. Model options
    if (!subCmd) {
      m = /^\\/model(?:\\s+(\\S*))?$/.exec(val);
      if (m) {
        subCmd = 'model';
        prefix = (m[1] || '').toLowerCase();
        const list = MODELS[cli] || [];
        options = list.map(function(o) {
          return { name: o.value, desc: o.label, insert: '/model ' + o.value };
        });
      }
    }
    // 3. Mode options
    if (!subCmd) {
      m = /^\\/mode(?:\\s+(\\S*))?$/.exec(val);
      if (m) {
        subCmd = 'mode';
        prefix = (m[1] || '').toLowerCase();
        const list = MODES[cli] || [];
        options = list.map(function(o) {
          return { name: o.value, desc: o.label + ' - ' + o.title, insert: '/mode ' + o.value };
        });
      }
    }
    // 4. Effort options
    if (!subCmd) {
      m = /^\\/effort(?:\\s+(\\S*))?$/.exec(val);
      if (m) {
        subCmd = 'effort';
        prefix = (m[1] || '').toLowerCase();
        options = EFFORTS.map(function(o) {
          return { name: o.value, desc: o.label + ' - ' + o.title, insert: '/effort ' + o.value };
        });
      }
    }

    if (subCmd) {
      activeSlashMatches = options.filter(function(opt) {
        return opt.name.toLowerCase().startsWith(prefix);
      });
      // If the user fully typed the sub-command argument, hide the menu
      if (activeSlashMatches.length === 1 && prefix === activeSlashMatches[0].name.toLowerCase()) {
        slashMenu.style.display = 'none';
        activeSlashMatches = [];
        return;
      }
    } else {
      // Otherwise match the main slash commands
      const mainMatch = /^\\/(\\S*)$/.exec(val);
      if (!mainMatch) {
        slashMenu.style.display = 'none';
        activeSlashMatches = [];
        return;
      }
      prefix = mainMatch[1].toLowerCase();
      activeSlashMatches = slashCommandsForCli().filter(function(cmd) {
        return cmd.name.toLowerCase().startsWith(prefix);
      });
    }

    if (activeSlashMatches.length === 0) {
      slashMenu.style.display = 'none';
      return;
    }

    if (slashIdx >= activeSlashMatches.length) {
      slashIdx = activeSlashMatches.length - 1;
    }
    if (slashIdx < 0) {
      slashIdx = 0;
    }

    let html = '';
    activeSlashMatches.forEach(function(cmd, idx) {
      const isSel = idx === slashIdx;
      const label = subCmd ? cmd.name : '/' + cmd.name;
      html += '<div class="slashOpt' + (isSel ? ' sel' : '') + '" data-idx="' + idx + '">' +
                '<span class="cmd">' + escapeHtml(label) + '</span>' +
                '<span class="desc">' + escapeHtml(cmd.desc || '') + '</span>' +
              '</div>';
    });
    html += '<div class="slashHint">Use ↑↓ to navigate, Tab/Enter to select, Esc to close</div>';
    slashMenu.innerHTML = html;
    slashMenu.style.display = 'flex';
  }

  function completeSlash(c) {
    input.value = c.insert;
    autoGrowInput();
    suppressSlash = false;
    slashMenu.style.display = 'none';
    activeSlashMatches = [];
    input.focus();
    if (c.insert.endsWith(' ')) {
      renderSlashMenu();
    }
  }

  slashMenu.addEventListener('click', function(e) {
    const opt = e.target.closest('.slashOpt');
    if (opt) {
      e.stopPropagation();
      const idx = parseInt(opt.getAttribute('data-idx') || '0', 10);
      if (activeSlashMatches[idx]) {
        completeSlash(activeSlashMatches[idx]);
      }
    }
  });

  // Platform = which CLI. Model = the actual model inside it. This shared catalog is
  // also used by the CLI picker so surfaces don't drift (the old webview list had stale
  // Codex entries that no longer matched the CLI).
  const MODELS = ${MODEL_OPTIONS_JSON};
  const modelValue = (opt) => (opt && opt.value) ? opt.value : 'default';
  // Permission/approval mode per engine. claude → SDK permissionMode; codex → a
  // sandbox+approval preset (mapped host-side in spawn). Like MODELS this is just a
  // wrapper label table — when a CLI changes its modes, only this list needs editing.
  // English labels mirror what each CLI calls these modes natively.
  const MODES = {
    claude: [
      { value: 'default',     label: 'Ask edits',    title: 'Ask before each file edit (default)' },
      { value: 'acceptEdits', label: 'Auto edit',    title: 'Auto-accept file edits; still ask for other tools' },
      { value: 'plan',        label: 'Plan',         title: 'Plan mode: read-only until you approve the plan' },
    ],
    codex: [
      { value: 'readonly', label: 'Read only',   title: 'Read-only sandbox; ask before edits, commands, network' },
      { value: 'auto',     label: 'Auto accept', title: 'Auto-accept edits + run inside the workspace; approve on failure (default)' },
      { value: 'full',     label: 'Full access', title: 'Full disk + network access, never ask (use with care)' },
    ],
  };
  // reasoning effort levels (applies to both engines; labels mirror CLI EffortPicker)
  const EFFORTS = [
    { value: 'default', label: 'default',  title: 'Engine default (usually medium)' },
    { value: 'low',     label: 'low',      title: 'Minimal thinking, fastest' },
    { value: 'medium',  label: 'medium',   title: 'Moderate reasoning' },
    { value: 'high',    label: 'high',     title: 'Deeper thinking' },
    { value: 'xhigh',  label: 'x-high',   title: 'Extended reasoning' },
    { value: 'max',     label: 'max',      title: 'Maximum effort (select models)' },
  ];
  // remember the chosen mode + model + effort per engine so switching tabs restores them.
  // model starts null (not 'default') so currentModel() falls to the first real model and
  // the chip shows its actual name (e.g. "Opus 4.8") instead of an opaque "default".
  const modeByCli = { claude: 'acceptEdits', codex: 'auto' };
  const modelByCli = { claude: null, codex: null };
  const effortByCli = { claude: 'default', codex: 'default' };
  let cli = 'claude';
  let cliReport = null;

  // ---- platform tabs + model picker (chip + popover, mirroring the mode picker) ----
  function currentModel() {
    const opts = MODELS[cli] || [];
    return modelByCli[cli] || modelValue(opts[0]);
  }
  // Build the model picker for the active engine: set the chip label to the current
  // model and render one popover row per model (label + actual value + a check on the
  // selected one). Keep the chip concise; put the extra detail in the picker rows.
  function fillModels() {
    const opts = MODELS[cli] || [{ chipLabel: 'default', label: 'Default', description: 'No model override' }];
    const cur = currentModel();
    const curOpt = opts.find(o => modelValue(o) === cur) || opts[0];
    modelLabel.textContent = curOpt ? (curOpt.chipLabel || curOpt.label) : (cur === 'default' ? 'default' : cur);
    modelMenu.innerHTML = '';
    for (const m of opts) {
      const row = document.createElement('div');
      const value = modelValue(m);
      row.className = 'modeOpt' + (value === cur ? ' sel' : '');
      const txt = document.createElement('div'); txt.className = 'mtext';
      const lab = document.createElement('div'); lab.className = 'mlabel'; lab.textContent = m.label;
      txt.appendChild(lab);
      if (m.description) { const d = document.createElement('div'); d.className = 'mdesc'; d.textContent = m.description; txt.appendChild(d); }
      const chk = document.createElement('span'); chk.className = 'mcheck'; chk.textContent = '✓';
      row.appendChild(txt); row.appendChild(chk);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        modelByCli[cli] = value;
        modelMenu.style.display = 'none';
        fillModels();
        vscode.postMessage({ type: 'model', model: value });
      });
      modelMenu.appendChild(row);
    }
  }
  function applyModelOptions(engine, options) {
    if (!engine || !Array.isArray(options) || !options.length) return;
    MODELS[engine] = options;
    const cur = modelByCli[engine] || 'default';
    const changed = !options.some((o) => modelValue(o) === cur);
    if (changed) modelByCli[engine] = modelValue(options[0]);
    if (engine === cli) {
      fillModels();
      if (changed) vscode.postMessage({ type: 'model', model: currentModel() });
    }
  }
  // open the model popover anchored above its chip (composer is at the bottom, so it
  // opens upward); position:fixed keeps it out of #inputWrap's overflow clip.
  function openModelMenu() {
    const r = modelBtn.getBoundingClientRect();
    modelMenu.style.display = 'block';
    modelMenu.style.left = r.left + 'px';
    modelMenu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  }
  // the currently selected permission mode for the active engine
  function currentMode() {
    const opts = MODES[cli] || [];
    return modeByCli[cli] || (opts[0] && opts[0].value);
  }
  // Build the mode picker for the active engine: set the chip label to the current
  // mode and render one popover row per mode (label + description + a check on the
  // selected one). Re-run on tab switch and after a selection so both stay in sync.
  function fillModes() {
    const opts = MODES[cli] || [{ value: 'default', label: 'default' }];
    const cur = currentMode();
    const curOpt = opts.find(o => o.value === cur) || opts[0];
    modeLabel.textContent = curOpt ? curOpt.label : 'mode';
    // the chip carries effort as a tail, but only when it's off default — nothing to
    // report otherwise, and a bare "Auto edit" stays readable in a narrow panel
    const curEff = currentEffort();
    const curEffOpt = EFFORTS.find(o => o.value === curEff);
    modeEffortTag.textContent = curEff === 'default' || !curEffOpt ? '' : '· ' + curEffOpt.label;
    modeMenu.innerHTML = '';
    for (const m of opts) {
      const row = document.createElement('div');
      row.className = 'modeOpt' + (m.value === cur ? ' sel' : '');
      const txt = document.createElement('div'); txt.className = 'mtext';
      const lab = document.createElement('div'); lab.className = 'mlabel'; lab.textContent = m.label;
      txt.appendChild(lab);
      if (m.title) { const d = document.createElement('div'); d.className = 'mdesc'; d.textContent = m.title; txt.appendChild(d); }
      const chk = document.createElement('span'); chk.className = 'mcheck'; chk.textContent = '✓';
      row.appendChild(txt); row.appendChild(chk);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        modeByCli[cli] = m.value;
        modeMenu.style.display = 'none';
        fillModes();
        vscode.postMessage({ type: 'mode', mode: m.value });
      });
      modeMenu.appendChild(row);
    }
    // effort, below the modes in the same popover: both answer "how does this engine run",
    // so they share a menu. Chips instead of rows keep six levels from doubling its height.
    const div = document.createElement('div'); div.className = 'mdiv';
    const head = document.createElement('div'); head.className = 'mSection';
    head.textContent = 'Effort · reasoning depth';
    const chips = document.createElement('div'); chips.className = 'effChips';
    for (const e of EFFORTS) {
      const chip = document.createElement('button');
      chip.className = 'effChip' + (e.value === curEff ? ' sel' : '');
      chip.textContent = e.label;
      if (e.title) chip.title = e.title;   // the row description survives as a tooltip
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        effortByCli[cli] = e.value;
        modeMenu.style.display = 'none';
        fillModes();
        vscode.postMessage({ type: 'effort', effort: e.value === 'default' ? undefined : e.value });
      });
      chips.appendChild(chip);
    }
    modeMenu.appendChild(div); modeMenu.appendChild(head); modeMenu.appendChild(chips);
  }
  // open the popover anchored above the chip (composer sits at the bottom of the
  // panel, so it opens upward); position:fixed keeps it out of #inputWrap's clip.
  function openModeMenu() {
    const r = modeBtn.getBoundingClientRect();
    modeMenu.style.display = 'block';
    modeMenu.style.left = r.left + 'px';
    modeMenu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  }
  function currentEffort() { return effortByCli[cli] || 'default'; }
  function setTab(next) {
    if (next !== 'claude' && next !== 'codex') return;
    cli = next;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.cli === cli));
    composer.dataset.cli = cli;                       // tints the input (claude=orange/codex=green)
    if (jumpBtn) jumpBtn.dataset.cli = cli;           // jump button shares the send button's engine accent
    input.placeholder = 'Message ' + cli + '... (Enter to send)';
    fillModels();
    fillModes();
  }
  function selectTab(next) {
    if (next === cli) return;
    setTab(next);
    const status = cliReport && cliReport[next];
    if (status === 'missing') {
      renderNotice((next === 'claude' ? 'Claude' : 'Codex') + ' is not installed.');
      return;
    }
    if (status === 'no-login') {
      renderNotice((next === 'claude' ? 'Claude' : 'Codex') + ' is not signed in. Type /login to connect it.');
      return;
    }
    vscode.postMessage({ type: 'platform', cli });
    vscode.postMessage({ type: 'model', model: currentModel() });
    vscode.postMessage({ type: 'mode', mode: currentMode() });
    vscode.postMessage({ type: 'effort', effort: currentEffort() === 'default' ? undefined : currentEffort() });
  }
  tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.cli)));
  // each chip toggles its own popover; clicking it again (while open) closes it
  modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (modelMenu.style.display === 'block') { modelMenu.style.display = 'none'; return; }
    modeMenu.style.display = 'none'; closeMenus();
    openModelMenu();
  });
  modelMenu.addEventListener('click', (e) => e.stopPropagation());
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (modeMenu.style.display === 'block') { modeMenu.style.display = 'none'; return; }
    modelMenu.style.display = 'none'; closeMenus();
    openModeMenu();
  });
  modeMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { modeMenu.style.display = 'none'; modelMenu.style.display = 'none'; });
  fillModels();
  fillModes();

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
  // Build the user-message block for a turn head. A long message starts COLLAPSED
  // (a few lines) with a "Show more" toggle; expanded it caps at 40vh and scrolls
  // inside, so a huge paste never pushes the chat off-screen.
  function makeUtext(userText) {
    const wrap = document.createElement('div'); wrap.className = 'utextWrap';
    const ut = document.createElement('div'); ut.className = 'utext'; ut.textContent = userText;
    wrap.appendChild(ut);
    const longMsg = (userText.split('\\n').length > 4) || (userText.length > 280);
    if (longMsg) {
      wrap.classList.add('collapsed');
      const tog = document.createElement('div'); tog.className = 'utextToggle'; tog.textContent = 'Show more';
      tog.addEventListener('click', () => {
        const exp = wrap.classList.toggle('expanded');
        wrap.classList.toggle('collapsed', !exp);
        tog.textContent = exp ? 'Show less' : 'Show more';
      });
      wrap.appendChild(tog);
    }
    return wrap;
  }
  function startTurn(userText, badgeCli, imageInfo) {
    const turn = document.createElement('div'); turn.className = 'turn';
    const head = document.createElement('div'); head.className = 'turnHead';
    head.innerHTML = '<span class="uq">&gt;</span>';
    head.appendChild(makeUtext(userText));
    if (badgeCli) { const b = document.createElement('span'); b.className = 'badge ' + badgeCli;
      b.textContent = badgeCli === 'codex' ? 'codex · gpt' : 'claude'; head.appendChild(b); }
    const imgEl = userImagesEl(imageInfo);
    if (imgEl) head.appendChild(imgEl);
    const body = document.createElement('div'); body.className = 'turnBody';
    turn.appendChild(head); turn.appendChild(body);
    log.appendChild(turn);
    turn._body = body; tailTurn = turn;
    scrollToLatest(); // a new user command — always jump to it
    syncWatermark();
    return body;
  }
  // Open a turn at the TOP (prepended older history). Same shape, inserted first.
  function startTurnTop(userText, badgeCli) {
    const turn = document.createElement('div'); turn.className = 'turn';
    const head = document.createElement('div'); head.className = 'turnHead';
    head.innerHTML = '<span class="uq">&gt;</span>';
    head.appendChild(makeUtext(userText));
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
    if (dir !== 'head') stickToBottom();
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
    appendNode(node, prepend ? 'head' : 'tail');
    el._row = node; // node element, so callers can attach a footer / clamp toggle
    return el;
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
      const icon = t.name === 'Read' ? '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7l5 5v13H6Z"/><path d="M13 3v5h5"/><path d="M9 13h6M9 16.5h6"/></svg>' : t.name === 'Write' ? '✎' : '•';
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
    if (!prepend) { if (typingEl) tailBody().appendChild(typingEl); stickToBottom(); }
  }

  // ---- tool-approval card ----
  // When the engine needs a tool approved, render a green-accented card showing what
  // it wants to do (the command / file / diff) with [Approve] [Always] [Deny] buttons.
  // Clicking posts the decision back; the card then locks to show the resolution.
  // Remove an approval card by request id — used when the decision was made on another surface
  // (the macOS desktop popup answered it), so the now-stale on-screen card clears itself.
  function dismissApproval(id) {
    const cards = approvalDock.querySelectorAll('[data-approval-id]');
    for (const c of cards) { if (c.dataset.approvalId === id) { c.remove(); syncComposerLock(); break; } }
  }
  function renderApproval(req) {
    const card = document.createElement('div');
    card.className = 'approvalCard';
    card.dataset.approvalId = req.id; // so the host can dismiss THIS card if answered elsewhere (desktop popup)
    // Skill MARKET approvals get the "forge" treatment — a tinted card with a soft glow +
    // a few slow twinkles. Publishing (make) glows violet; buying glows gold (the collectible
    // accent), so acquiring a skill feels like opening a treasure. Every other approval stays
    // the green card.
    const isPublish = /publish_skill/.test(req.tool || '') || /publish_skill/.test(req.title || '');
    const isBuy = /buy_skill/.test(req.tool || '') || /buy_skill/.test(req.title || '');
    const isForge = isPublish || isBuy;
    if (isForge) {
      card.classList.add('skillForge');
      if (isBuy) card.classList.add('buyForge'); // gold variant
      const stars = document.createElement('div'); stars.className = 'forgeStars';
      for (let i = 0; i < 6; i++) {
        const s = document.createElement('span'); s.className = 'st'; s.innerHTML = '<svg class="anic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 14.4 9.6 22 12 14.4 14.4 12 22 9.6 14.4 2 12 9.6 9.6Z"/></svg>';
        s.style.left = (8 + Math.random() * 84) + '%';
        s.style.top = (12 + Math.random() * 70) + '%';
        s.style.animationDuration = (3.2 + Math.random() * 2.4) + 's';
        s.style.animationDelay = (Math.random() * 3) + 's';
        s.style.fontSize = (7 + Math.random() * 5) + 'px';
        stars.appendChild(s);
      }
      card.appendChild(stars);
    }

    // ── AskUserQuestion: a choice/free-text prompt (claude/codex both route here). The
    // user's answer becomes the tool result, so this card renders options as chips plus
    // an optional input field and sends structured questionResponses — no Approve/Deny.
    if (req.kind === 'question' && Array.isArray(req.questions) && req.questions.length) {
      // Stepper: when several questions pile up, show ONE at a time with a "1 / N" counter.
      // Answering advances to the next; the last one's button sends all accumulated answers.
      const sel = {}; // qIndex → array of chosen labels
      const free = {}; // qIndex → typed answer
      const total = req.questions.length;
      let step = 0;
      const hasAnswer = (qi) => {
        const typed = (free[qi] || '').trim();
        return typed.length > 0 || !!(sel[qi] && sel[qi].length);
      };
      const sendAll = () => {
        const questionResponses = req.questions.map((q, qi) => {
          const typed = (free[qi] || '').trim();
          return {
            question: q.question,
            questionId: q.id,
            selected: typed ? [] : (sel[qi] || []),
            ...(typed ? { text: typed } : {}),
          };
        });
        vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome: 'once', questionResponses });
        card.remove(); syncComposerLock();
      };
      const renderStep = () => {
        card.innerHTML = '';
        const q = req.questions[step];
        let updateNext = () => {};
        let otherInput = null;
        if (total > 1) {
          const counter = document.createElement('div'); counter.className = 'qCount';
          counter.textContent = (step + 1) + ' / ' + total;
          card.appendChild(counter);
        }
        const block = document.createElement('div'); block.className = 'qBlock';
        if (q.header) { const h = document.createElement('span'); h.className = 'qHeader'; h.textContent = q.header; block.appendChild(h); }
        const qt = document.createElement('div'); qt.className = 'qText'; qt.textContent = q.question; block.appendChild(qt);
        const opts = document.createElement('div'); opts.className = 'qOpts';
        (q.options || []).forEach((opt) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'qOpt';
          if ((sel[step] || []).indexOf(opt.label) >= 0) b.classList.add('on');
          const t = document.createElement('div'); t.className = 'qOptLabel'; t.textContent = opt.label; b.appendChild(t);
          if (opt.description) { const d = document.createElement('div'); d.className = 'qOptDesc'; d.textContent = opt.description; b.appendChild(d); }
          b.addEventListener('click', () => {
            const cur = sel[step] || [];
            delete free[step];
            if (q.multiSelect) {
              sel[step] = cur.indexOf(opt.label) >= 0 ? cur.filter((l) => l !== opt.label) : cur.concat(opt.label);
            } else {
              sel[step] = cur[0] === opt.label ? [] : [opt.label];
            }
            Array.from(opts.children).forEach((c, i) => c.classList.toggle('on', (sel[step] || []).indexOf((q.options[i] || {}).label) >= 0));
            if (otherInput) otherInput.value = '';
            updateNext();
          });
          opts.appendChild(b);
        });
        block.appendChild(opts);
        if (q.allowCustomInput) {
          const label = document.createElement('div');
          label.className = 'qOtherLabel';
          label.textContent = q.options && q.options.length ? 'Or type your own answer' : 'Type your answer';
          block.appendChild(label);
          otherInput = q.secret ? document.createElement('input') : document.createElement('textarea');
          otherInput.className = 'qOtherInput';
          otherInput.placeholder = 'Type your answer…';
          if (q.secret) otherInput.type = 'password';
          else otherInput.rows = 3;
          if (free[step]) otherInput.value = free[step];
          otherInput.addEventListener('input', () => {
            free[step] = otherInput.value;
            sel[step] = [];
            Array.from(opts.children).forEach((c) => c.classList.remove('on'));
            updateNext();
          });
          block.appendChild(otherInput);
        }
        card.appendChild(block);
        const actions = document.createElement('div'); actions.className = 'apActions';
        if (step > 0) {
          const back = document.createElement('button'); back.className = 'apBtn always'; back.textContent = 'Back';
          back.addEventListener('click', () => { step -= 1; renderStep(); });
          actions.appendChild(back);
        }
        const next = document.createElement('button'); next.className = 'apBtn ok';
        const last = step === total - 1;
        next.textContent = last ? 'Send' : 'Next';
        next.addEventListener('click', () => {
          if (!hasAnswer(step)) return;
          if (last) sendAll(); else { step += 1; renderStep(); }
        });
        actions.appendChild(next);
        card.appendChild(actions);
        updateNext = () => { next.disabled = !hasAnswer(step); };
        updateNext();
      };
      renderStep();
      approvalDock.insertBefore(card, approvalDock.firstChild);
      syncComposerLock();
      return;
    }

    // ── plan / bash / edit / read / write: a yes-or-no permission card ──
    const isPlan = req.kind === 'plan';
    const isDanger = req.risk === 'danger';
    const head = document.createElement('div'); head.className = 'apHead' + (isDanger ? ' apDanger' : '');
    const glyphEl = document.createElement('span'); glyphEl.className = 'apk';
    var skSvg = '<svg class="anic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 14.4 9.6 22 12 14.4 14.4 12 22 9.6 14.4 2 12 9.6 9.6Z"/></svg>';
    var rdSvg = '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7l5 5v13H6Z"/><path d="M13 3v5h5"/><path d="M9 13h6M9 16.5h6"/></svg>';
    glyphEl.innerHTML = req.kind === 'bash' ? '$' : req.kind === 'read' ? rdSvg : isPlan ? skSvg : isForge ? skSvg : '✎';
    head.appendChild(glyphEl);
    if (isDanger) {
      const warn = document.createElement('span'); warn.style.cssText = 'color:var(--vscode-errorForeground,#f44);font-weight:700;margin-right:4px';
      warn.innerHTML = '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21 19.5H3L12 3.5Z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg> DANGER ·'; head.appendChild(warn);
    }
    const ttl = document.createElement('span'); ttl.className = 'apTitle';
    ttl.textContent = isPublish ? ('Forge skill: ' + ((req.input && req.input.name) || 'new skill'))
      : isBuy ? ('Buy skill' + ((req.input && req.input.name) ? (': ' + req.input.name) : ''))
      : (req.title || req.tool);
    head.appendChild(ttl);
    const tag = document.createElement('span'); tag.className = 'apTag'; tag.textContent = req.cli;
    head.appendChild(tag);
    card.appendChild(head);

    // detail: command for bash (editable), plan text for plan, diff for edit, file for read/write
    let commandInput = null; // textarea for bash edit mode
    if (req.command) {
      const pre = document.createElement('pre'); pre.className = 'apBody'; pre.textContent = req.command;
      card.appendChild(pre);
      // bash: allow editing the command before approving
      if (req.kind === 'bash') {
        commandInput = document.createElement('textarea');
        commandInput.className = 'apBody';
        commandInput.style.cssText = 'display:none;width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;font-size:0.85em;background:var(--an-bg-1);border:1px solid var(--eng);border-radius:4px;padding:6px;color:inherit';
        commandInput.value = req.command;
        card.appendChild(commandInput);
        const PENCIL_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
        const XMARK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
        const editBtn = document.createElement('button'); editBtn.className = 'apEdit';
        editBtn.innerHTML = PENCIL_SVG; editBtn.title = 'Edit'; editBtn.setAttribute('aria-label', 'Edit');
        editBtn.addEventListener('click', () => {
          const editing = commandInput.style.display !== 'none';
          pre.style.display = editing ? '' : 'none';
          commandInput.style.display = editing ? 'none' : '';
          editBtn.innerHTML = editing ? PENCIL_SVG : XMARK_SVG;
          editBtn.title = editing ? 'Edit' : 'Cancel';
        });
        head.appendChild(editBtn);
      }
    } else if (req.plan) {
      const pre = document.createElement('pre'); pre.className = 'apBody planBody'; pre.textContent = req.plan;
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
    } else if (isPublish && req.input) {
      // show WHAT is being forged: name + description + price, so the approval is meaningful
      const box = document.createElement('div'); box.className = 'apBody forgeBody';
      const nm = document.createElement('div'); nm.style.cssText = 'font-weight:600;font-size:1.02em'; nm.textContent = req.input.name || 'new skill';
      box.appendChild(nm);
      if (req.input.description) {
        const d = document.createElement('div'); d.style.cssText = 'opacity:0.85;font-size:0.85em;margin-top:2px'; d.textContent = req.input.description; box.appendChild(d);
      }
      const priceSol = req.input.priceSol;
      const priceTxt = priceSol == null ? '0.1 SOL' : String(priceSol) === '0' ? 'free' : priceSol + ' SOL';
      const meta = document.createElement('div'); meta.style.cssText = 'margin-top:5px;font-size:0.8em;opacity:0.7'; meta.textContent = 'mint a soulbound NFT · price ' + priceTxt;
      box.appendChild(meta);
      card.appendChild(box);
    }

    const actions = document.createElement('div'); actions.className = 'apActions';
    const decide = (outcome, extra) => {
      vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome, ...extra });
      card.remove(); // answered → clear it from the dock
      syncComposerLock(); // unfreeze once the last pending approval is answered
    };
    const mk = (label, outcome, cls) => {
      const b = document.createElement('button'); b.className = 'apBtn ' + cls; b.textContent = label;
      b.addEventListener('click', () => decide(outcome)); return b;
    };

    if (isPlan) {
      // plan has no "Always" and no edit/deny-reason
      actions.appendChild(mk('Approve plan', 'once', 'ok'));
      actions.appendChild(mk('Keep planning', 'deny', 'no'));
    } else {
      actions.appendChild(mk('Approve', 'once', 'ok'));
      actions.appendChild(mk('Always', 'always', 'always'));

      // bash: "Approve edited" (visible only when edit mode is active)
      let approveEdited = null;
      if (req.kind === 'bash' && commandInput) {
        approveEdited = document.createElement('button');
        approveEdited.className = 'apBtn ok'; approveEdited.textContent = 'Approve edited';
        approveEdited.style.display = 'none';
        approveEdited.addEventListener('click', () => {
          decide('once', { updatedInput: { ...(req.input ?? {}), command: commandInput.value } });
        });
        actions.appendChild(approveEdited);
        // sync visibility with the edit toggle button in the header
        const editToggle = head.querySelector('button');
        if (editToggle) {
          editToggle.addEventListener('click', () => {
            const isEditing = commandInput.style.display !== 'none';
            if (approveEdited) approveEdited.style.display = isEditing ? '' : 'none';
          });
        }
      }

      // deny-with-reason: clicking Deny reveals a reason input; the reason row's Deny sends
      const reasonRow = document.createElement('div');
      reasonRow.style.cssText = 'display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap';
      const reasonInput = document.createElement('input'); reasonInput.type = 'text';
      reasonInput.placeholder = 'Reason for denying (optional)';
      reasonInput.style.cssText = 'flex:1;min-width:120px;background:var(--an-bg-1);border:1px solid var(--an-line);border-radius:4px;padding:4px 8px;font-size:0.82em;color:inherit;outline:none';
      const confirmDeny = document.createElement('button'); confirmDeny.className = 'apBtn no'; confirmDeny.textContent = 'Deny';
      confirmDeny.addEventListener('click', () => decide('deny', { reason: reasonInput.value.trim() || undefined }));
      const cancelDeny = document.createElement('button'); cancelDeny.className = 'apBtn'; cancelDeny.textContent = '↩';
      cancelDeny.style.cssText = 'opacity:0.6'; cancelDeny.addEventListener('click', () => { reasonRow.style.display = 'none'; });
      reasonRow.appendChild(reasonInput); reasonRow.appendChild(confirmDeny); reasonRow.appendChild(cancelDeny);

      // Deny button: first click reveals reason row; doesn't call decide() directly
      const denyBtn = document.createElement('button'); denyBtn.className = 'apBtn no'; denyBtn.textContent = 'Deny';
      denyBtn.addEventListener('click', () => {
        reasonRow.style.display = 'flex';
        reasonInput.focus();
      });
      actions.appendChild(denyBtn);
      card.appendChild(actions);
      card.appendChild(reasonRow);
    }

    if (isPlan) card.appendChild(actions);

    // keyboard: ← → move focus between action buttons, Enter/Space activates focused button.
    card.addEventListener('keydown', (e) => {
      const btnsAll = Array.from(actions.querySelectorAll('button'));
      const i = btnsAll.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); btnsAll[(i + 1) % btnsAll.length].focus(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); btnsAll[(i + btnsAll.length - 1) % btnsAll.length].focus(); }
    });

    // dock it just above the composer (newest on top), not inside the scrolling log
    approvalDock.insertBefore(card, approvalDock.firstChild);
    syncComposerLock(); // freeze the input while this (and any other) approval is open
    // Default focus = Approve so Enter approves right away — BUT only when THIS panel is
    // the one the user is actually in. Each VSCode webview is its own document, so an
    // approval popping in a BACKGROUND session would otherwise yank focus out of the
    // panel the user is typing in. document.hasFocus() is false for that background
    // webview, so we skip the auto-focus there and leave the active panel alone.
    if (document.hasFocus()) { const first = actions.querySelector('button'); if (first) first.focus(); }
  }

  function onMessage(msg) {
    // a user command OPENS a new turn (its sticky header); everything after attaches
    // to that turn until the next user command.
    if (msg.role === 'user') {
      // live thumbnails if THIS echo matches the images we just sent; otherwise (history
      // replay) a lightweight "N image" chip from the stored count — base64 isn't persisted.
      const info = pendingSentImages.length ? { thumbs: pendingSentImages.splice(0) }
                 : msg.imageCount ? { count: msg.imageCount } : undefined;
      const body = startTurn(msg.text, undefined, info);
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
    // Some runtimes send token deltas; others resend the full text-so-far. Accept both.
    const asMd = (el, raw) => { if (msg.role === 'assistant') renderMd(el, raw); else { el.textContent = raw; el.dataset.md = raw; } };
    if (msg.partial) {
      if (!streaming || streaming.dataset.role !== msg.role) {
        streaming = bubble(msg.role, false, badge);
        streaming.dataset.role = msg.role;
        streaming.dataset.acc = '';
        streaming.classList.add('cursor');
      }
      // Producers always send partials as the cumulative "full text so far"
      // (replace-semantics — see runtime/spawn.ts). So REPLACE the bubble, never
      // append. The old startsWith()+append heuristic desynced on any hiccup and
      // then compounded every later snapshot into quadratic repeated text (the
      // runaway streaming-duplication bug).
      streaming.dataset.acc = msg.text;
      scheduleStreamRender(); // live markdown + tail-follow, throttled to one paint/frame
      return; // stick/typing happens in flushStreamRender — no forced layout per token
    } else {
      if (streaming && streaming.dataset.role === msg.role) {
        const prev = streaming.dataset.acc || '';
        const raw = msg.text.startsWith(prev) ? msg.text : prev + msg.text;
        streaming.classList.remove('cursor');
        if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = 0; } // drop any pending live render
        asMd(streaming, raw);
        streaming = null;
      } else {
        const el = bubble(msg.role, false, badge);
        asMd(el, msg.text);
        if (msg.role === 'assistant') addFooter(el._row, msg.durationMs, msg.model); // time + model
      }
    }
    if (typingEl) tailBody().appendChild(typingEl); // keep the indicator at the thread's tail
    stickToBottom();
  }

  // ---- session list (title + relative time + 모두 보기) ----
  function renderSessions() {
    sessList.innerHTML = '';
    // A degraded cloud makes this list silently local-only; say so instead of letting
    // sessions from other devices look deleted. reauth = sign-in dead (user must
    // reconnect in Storage); transient = network/5xx, may heal on the next refresh.
    if (cloudListState === 'reauth' || cloudListState === 'transient') {
      const warn = document.createElement('div');
      warn.style.cssText = 'padding:4px 8px;font-size:11px;color:var(--vscode-editorWarning-foreground, #e5c07b);opacity:.9';
      warn.textContent = cloudListState === 'reauth'
        ? 'Cloud sync signed out. Showing this device only. Reconnect in Storage.'
        : 'Cloud unreachable. Showing this device only.';
      sessList.appendChild(warn);
    }
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
    setBusy(true); // a turn is running → the Send button becomes Stop
    if (typingEl) return;
    const node = document.createElement('div');
    node.className = 'node typing';
    node.innerHTML = '<div class="typing"><span class="who">' + cli
      + '</span><span class="dots"><i></i><i></i><i></i></span></div>';
    tailBody().appendChild(node);
    stickToBottom();
    typingEl = node;
  }
  function hideTyping() { setBusy(false); if (typingEl) { typingEl.remove(); typingEl = null; } }

  // Send ⇄ Stop: while a turn runs, the primary button interrupts it (claude q.interrupt
  // / codex turn/interrupt) instead of sending. The session survives — the next message
  // continues the same conversation.
  let busy = false;
  function setBusy(b) {
    if (busy === b) return;
    busy = b;
    const btn = document.getElementById('send');
    if (!btn) return;
    const lbl = btn.querySelector('.lbl');
    if (lbl) lbl.textContent = b ? 'Stop' : 'Send';
    btn.title = b ? 'Stop' : 'Send';
    btn.setAttribute('aria-label', b ? 'Stop' : 'Send');
    btn.classList.toggle('stopping', b);
  }
  function interruptTurn() {
    vscode.postMessage({ type: 'interrupt' });
    setBusy(false); // optimistic: drop the dots now; the engine's turnEnd confirms
    hideTyping();
  }

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

  // ---- image attachments (paperclip / paste / drag-drop) ----
  // each: { dataUrl, mime, dataBase64, name }. dataUrl drives the thumbnail + the live
  // sent-bubble; {mime, dataBase64, name} is the payload posted to the host.
  let attached = [];
  // images we just sent, held until the host echoes the user turn so we can paint the
  // real thumbnails onto that bubble (base64 is never persisted, so history can't).
  let pendingSentImages = [];
  const attachStrip = document.getElementById('attachStrip');
  const fileInput = document.getElementById('fileInput');
  const attachBtn = document.getElementById('attachBtn');
  const inputWrap = document.getElementById('inputWrap');

  function renderAttachStrip() {
    attachStrip.innerHTML = '';
    attachStrip.style.display = attached.length ? 'flex' : 'none';
    attached.forEach((a, i) => {
      const t = document.createElement('div'); t.className = 'thumb';
      const img = document.createElement('img'); img.src = a.dataUrl; img.alt = a.name || 'image';
      const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove';
      rm.addEventListener('click', () => { attached.splice(i, 1); renderAttachStrip(); });
      t.appendChild(img); t.appendChild(rm); attachStrip.appendChild(t);
    });
  }
  // build the image row for a user bubble: live thumbs ({thumbs:[url]}) or a count chip
  // ({count:N}) for replayed history where the base64 is gone.
  function userImagesEl(info) {
    if (!info) return null;
    if (info.thumbs && info.thumbs.length) {
      const row = document.createElement('div'); row.className = 'msgImgs';
      info.thumbs.forEach((u) => { const im = document.createElement('img'); im.src = u; row.appendChild(im); });
      return row;
    }
    if (info.count) {
      const chip = document.createElement('span'); chip.className = 'imgChip';
      chip.innerHTML = '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3.5 17 4.5-4.5 3.5 3.5 4-4 5 5"/></svg>' + info.count + (info.count > 1 ? ' images' : ' image');
      return chip;
    }
    return null;
  }
  function addFiles(files) {
    for (const f of files) {
      if (!f.type || f.type.indexOf('image/') !== 0) continue; // images only
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return;
        attached.push({ dataUrl, mime: f.type, dataBase64: dataUrl.slice(comma + 1), name: f.name || 'pasted' });
        renderAttachStrip();
      };
      reader.readAsDataURL(f);
    }
  }
  attachBtn.addEventListener('click', () => { if (!input.disabled) fileInput.click(); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files || []); fileInput.value = ''; });
  // paste an image straight from the clipboard
  input.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imgs = [];
    for (const it of items) { if (it.kind === 'file' && it.type.indexOf('image/') === 0) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  });
  // drag an image file onto the composer
  ['dragenter', 'dragover'].forEach((ev) => inputWrap.addEventListener(ev, (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) {
      e.preventDefault(); inputWrap.classList.add('dragover');
    }
  }));
  ['dragleave', 'drop'].forEach((ev) => inputWrap.addEventListener(ev, (e) => {
    if (ev === 'drop') { e.preventDefault(); if (e.dataTransfer) addFiles(e.dataTransfer.files || []); }
    inputWrap.classList.remove('dragover');
  }));

  function send() {
    if (input.disabled) return;       // frozen while an approval is pending
    const text = input.value.trim();
    if (!text && !attached.length) return; // nothing to send (no text, no images)
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
    // ── real slash-command registry (local UI commands, not forwarded to the agent) ──
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.slice(1).split(' ');
      const arg = rest.join(' ').trim();
      switch (cmd) {
        case 'login': {
          const target = (arg === 'claude' || arg === 'codex') ? arg : cli;
          if (target === 'claude' && arg && arg !== 'claude' && arg !== 'codex') {
            vscode.postMessage({ type: 'claudeAuthCode', code: arg });
            renderNotice('Submitted Claude sign-in code.');
          } else {
            vscode.postMessage({ type: target === 'claude' ? 'startClaudeLogin' : 'startCodexLogin' });
            renderNotice('Starting ' + (target === 'claude' ? 'Claude' : 'Codex') + ' sign-in...');
          }
          input.value = ''; return;
        }
        case 'logout': {
          const target = (arg === 'claude' || arg === 'codex') ? arg : cli;
          vscode.postMessage({ type: 'logoutEngine', cli: target });
          renderNotice('Signing out of ' + (target === 'claude' ? 'Claude' : 'Codex') + '...');
          input.value = ''; return;
        }
        case 'new':
          vscode.postMessage({ type: 'new' });
          input.value = ''; return;
        case 'clear':
          vscode.postMessage({ type: 'clear' });
          input.value = ''; return;
        case 'compact':
          vscode.postMessage({ type: 'slashCommand', command: 'compact', arg });
          showTyping();
          input.value = ''; return;
        case 'status':
          vscode.postMessage({ type: 'slashCommand', command: 'status' });
          input.value = ''; return;
        case 'resume':
          vscode.postMessage({ type: 'slashCommand', command: 'resume' });
          input.value = ''; return;
        case 'diff':
          vscode.postMessage({ type: 'slashCommand', command: 'diff' });
          showTyping();
          input.value = ''; return;
        case 'permissions':
          if (arg) { modeByCli[cli] = arg; fillModes(); vscode.postMessage({ type: 'mode', mode: arg }); }
          else vscode.postMessage({ type: 'slashCommand', command: 'permissions' });
          input.value = ''; return;
        case 'init':
        case 'skills':
        case 'cost':
          vscode.postMessage({ type: 'slashCommand', command: cmd });
          input.value = ''; return;
        case 'review':
        case 'mcp':
          vscode.postMessage({ type: 'slashCommand', command: cmd, arg });
          showTyping();
          input.value = ''; return;
        case 'copy': {
          const last = Array.from(log.querySelectorAll('.node.assistant .msg')).pop();
          if (last && navigator.clipboard) navigator.clipboard.writeText(last.textContent || '').catch(() => {});
          input.value = ''; return;
        }
        case 'engine':
          if (arg === 'claude' || arg === 'codex') selectTab(arg);
          input.value = ''; return;
        case 'model':
          if (arg) { modelByCli[cli] = arg; fillModels(); vscode.postMessage({ type: 'model', model: arg }); }
          input.value = ''; return;
        case 'mode':
          if (arg) { modeByCli[cli] = arg; fillModes(); vscode.postMessage({ type: 'mode', mode: arg }); }
          input.value = ''; return;
        case 'effort':
          if (arg) { effortByCli[cli] = arg; fillModes(); vscode.postMessage({ type: 'effort', effort: arg === 'default' ? undefined : arg }); }
          input.value = ''; return;
        case 'help': {
          const helpText = slashCommandsForCli()
            .map(function(c) { return '/' + c.name + (c.args ? ' ' + c.args : '') + ' — ' + c.desc; })
            .join('\\n');
          const pre = document.createElement('pre');
          pre.style.cssText = 'margin:8px 0;padding:8px 12px;background:var(--an-bg-1);border-radius:6px;font-size:0.82em;opacity:0.8';
          pre.textContent = helpText;
          log.appendChild(pre); syncWatermark();
          input.value = ''; return;
        }
        default: {
          // Let native Claude/Codex slash commands, custom skills, and MCP prompts run
          // instead of blocking them in AgentNet's autocomplete layer.
          vscode.postMessage({ type: 'slashCommand', command: cmd, arg });
          showTyping();
          input.value = ''; return;
        }
      }
    }
    const activeStatus = cliReport && cliReport[cli];
    if (activeStatus === 'missing') {
      renderNotice((cli === 'claude' ? 'Claude' : 'Codex') + ' is not installed.');
      return;
    }
    if (activeStatus === 'no-login') {
      renderNotice((cli === 'claude' ? 'Claude' : 'Codex') + ' is not signed in. Type /login to connect it.');
      return;
    }
    const images = attached.map((a) => ({ mime: a.mime, dataBase64: a.dataBase64, name: a.name }));
    pendingSentImages = attached.map((a) => a.dataUrl); // painted onto the echoed bubble
    vscode.postMessage({ type: 'send', text, images });
    attached = []; renderAttachStrip();
    input.value = '';
    input.style.height = 'auto'; // collapse back to one row after sending
    showTyping();
  }
  // the primary button sends when idle, interrupts when a turn is running
  document.getElementById('send').addEventListener('click', () => { busy ? interruptTurn() : send(); });
  document.getElementById('newBtn').addEventListener('click', () => { vscode.postMessage({ type: 'new' }); closeMenus(); });
  document.getElementById('newTabBtn').addEventListener('click', () => vscode.postMessage({ type: 'newTab' }));
  input.addEventListener('keydown', (e) => {
    // e.isComposing = IME (Korean/Japanese/Chinese) mid-composition; don't send
    // a half-formed syllable. keyCode 229 is the legacy IME-in-progress signal.
    if (e.isComposing || e.keyCode === 229) return;

    if (activeSlashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashIdx = (slashIdx + 1) % activeSlashMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashIdx = (slashIdx - 1 + activeSlashMatches.length) % activeSlashMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (activeSlashMatches[slashIdx]) {
          completeSlash(activeSlashMatches[slashIdx]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        suppressSlash = true;
        renderSlashMenu();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && busy) { e.preventDefault(); interruptTurn(); } // Esc stops the turn
  });
  // Esc interrupts the running turn (Claude-Code style) even when the input isn't focused
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && busy) { e.preventDefault(); interruptTurn(); } });
  // Grow the textarea with its content; CSS max-height (~2.5x) then scrolls inside.
  // Reset to auto first so it shrinks when text is deleted; pasting a long message
  // grows to the cap and scrolls rather than pushing the chat off-screen.
  function autoGrowInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  }
  input.addEventListener('input', () => {
    autoGrowInput();
    suppressSlash = false;
    slashIdx = 0;
    renderSlashMenu();
  });

  // ---- storage pill (Local always on; Cloud optional mirror) ----
  const cloudState = document.getElementById('cloudState');
  const cloudBtn = document.getElementById('cloudBtn');
  let storageOptions = [];
  let cloudConnected = false;
  let cloudKind = ''; // which backend is connected, so a reauth prompt can reconnect the right one

  function renderStorage(info, options) {
    storageOptions = options || storageOptions;
    cloudConnected = !!(info && info.connected);
    if (info && info.kind) cloudKind = info.kind;
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

  // ---- view switcher: Chat / My Wallet (profile) / Market / Agents ----
  const panels = {
    chat: document.getElementById('chatView'),
    wallet: document.getElementById('walletView'),
    market: document.getElementById('marketView'),
    agents: document.getElementById('agentsView'),
    publish: document.getElementById('publishView'),
  };
  function showView(name) {
    for (const k in panels) panels[k].style.display = (k === name) ? 'flex' : 'none';
    document.getElementById('marketsBtn').classList.toggle('on', name === 'market');
    document.getElementById('agentsBtn').classList.toggle('on', name === 'agents');
    if (name === 'wallet') vscode.postMessage({ type: 'wallet' }); // refresh address
    if (name === 'market') openMarket();
    if (name === 'agents') openAgents();
  }
  document.getElementById('backToChat').addEventListener('click', () => showView('chat'));
  document.getElementById('backToChatM').addEventListener('click', () => showView('chat'));
  document.getElementById('backToChatA').addEventListener('click', () => showView('chat'));
  document.getElementById('backToChatP').addEventListener('click', () => showView('chat'));
  document.getElementById('marketsBtn').addEventListener('click', () => { closeMenus(); showView('market'); });
  document.getElementById('agentsBtn').addEventListener('click', () => { closeMenus(); showView('agents'); });
  // make-skill: two entry points (market header, skills panel) → publish view. Not in the
  // top bar: publishing is a market action, and it sits where you're already looking at skills.
  // the market button follows the active tab: on the Workflows tab it opens the workflow builder
  document.getElementById('mktMakeSkillBtn').addEventListener('click', () => openPublish(currentKind === 'workflow' ? 'workflow' : 'skill'));
  document.getElementById('panelMakeSkillBtn').addEventListener('click', () => {
    document.getElementById('skillsPanel').style.display = 'none'; // close the panel popover
    openPublish('skill');
  });

  // ---- make-skill: publish form (issue: author + publish a skill from the UI) ----
  const pubImage = document.getElementById('pubImage');
  const pubImageBadge = document.getElementById('pubImageBadge');
  const pubSubmit = document.getElementById('pubSubmit');
  const pubError = document.getElementById('pubError');
  // ── workflow builder: skill/workflow toggle + owned-skill picker ──────────
  // A workflow is defined by the skills it requires (the on-chain gate). Workflow mode hides
  // the SKILL.md body and shows a checklist of skills you own; on submit we synthesize the
  // frontmatter (type: workflow + requiredSkills) so the current backend mints it as a
  // workflow, and also send kind/requiredSkills for the newer contract path (forward-compat).
  let pubKind = 'skill';
  const pubFormEl = document.getElementById('pubForm');
  const pubTextWrap = document.getElementById('pubTextWrap');
  const pubReqWrap = document.getElementById('pubReqWrap');
  const pubReqEl = document.getElementById('pubReq');
  const pubReqCountEl = document.getElementById('pubReqCount');
  const pubReqSel = {}; // mint -> selected
  function chosenReqMints() { return Object.keys(pubReqSel).filter((m) => pubReqSel[m]); }
  function updatePubReqCount() {
    const c = chosenReqMints().length;
    pubReqCountEl.textContent = c ? (c + ' selected' + (c > 16 ? ' \\u2014 max 16, deselect some' : '')) : '';
  }
  function renderPubReq() {
    // Only real on-chain SKILLS qualify: the gate requires official-skills-collection members, so
    // a mint must exist AND not itself be a workflow (a workflow can't require another workflow).
    const owned = ownedSkills.filter((n) => !!skillMints[n] && !workflowMintSet.has(skillMints[n]));
    if (!owned.length) {
      pubReqEl.innerHTML = '<div class="empty">You don\\'t own any skills yet. Buy at least one before publishing a workflow.</div>';
      pubReqCountEl.textContent = '';
      return;
    }
    pubReqEl.innerHTML = '';
    for (const n of owned) {
      const mint = skillMints[n];
      const lab = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = mint; cb.checked = !!pubReqSel[mint];
      cb.addEventListener('change', () => { pubReqSel[mint] = cb.checked; updatePubReqCount(); });
      const span = document.createElement('span'); span.textContent = n;
      lab.appendChild(cb); lab.appendChild(span); pubReqEl.appendChild(lab);
    }
    updatePubReqCount();
  }
  function setPubKind(k) {
    pubKind = (k === 'workflow') ? 'workflow' : 'skill';
    const wf = pubKind === 'workflow';
    for (const b of document.querySelectorAll('.pubKind button')) b.classList.toggle('on', b.getAttribute('data-k') === pubKind);
    pubFormEl.classList.toggle('wf', wf);
    pubTextWrap.style.display = wf ? 'none' : '';
    pubReqWrap.style.display = wf ? '' : 'none';
    document.getElementById('pubFormHead').innerHTML = 'FORM // <b>PUBLISH ' + (wf ? 'WORKFLOW' : 'SKILL') + '</b>';
    document.getElementById('pubViewTitle').textContent = wf ? 'Make a workflow' : 'Make a skill';
    document.getElementById('pubViewDesc').textContent = wf
      ? 'Bundle skills you own into one workflow. Buyers must hold every skill it requires to unlock it.'
      : 'Publish a skill others can buy. It mints a soulbound NFT and the body is stored on-chain.';
    if (!pubSubmit.disabled) pubSubmit.textContent = wf ? 'Publish workflow' : 'Publish skill';
    if (wf) renderPubReq();
  }
  for (const b of document.querySelectorAll('.pubKind button')) b.addEventListener('click', () => setPubKind(b.getAttribute('data-k')));
  function openPublish(kind) { setPubKind(kind); showView('publish'); }
  // an on-chain image value is a base58 txid/PDA — NOT an http url and NOT a *.png/etc.
  // (skill-nft-json §3: the value's shape says where it lives, no isOnchain flag).
  function looksOnChain(v) {
    const s = (v || '').trim();
    if (!s) return false;
    if (/^https?:/i.test(s)) return false;
    if (/\\.(png|jpe?g|gif|webp|svg)$/i.test(s)) return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); // base58 address shape
  }
  pubImage.addEventListener('input', () => {
    pubImageBadge.style.display = looksOnChain(pubImage.value) ? 'inline-block' : 'none';
  });
  pubSubmit.addEventListener('click', () => {
    const name = document.getElementById('pubName').value.trim();
    const description = document.getElementById('pubDesc').value.trim();
    const priceSol = document.getElementById('pubPrice').value.trim();
    const category = document.getElementById('pubCategory').value.trim();
    const hashtags = document.getElementById('pubHashtags').value.split(',').map(h => h.trim()).filter(Boolean);
    const image = pubImage.value.trim();
    pubError.style.display = 'none';
    const fail = (msg) => { pubError.textContent = msg; pubError.style.display = 'block'; };
    if (!name) return fail('Name is required.');
    if (!description) return fail('Description is required.');
    let text; let reqMints = [];
    if (pubKind === 'workflow') {
      // Drop any workflow mint that slipped through (the gate rejects a workflow as a required skill).
      reqMints = chosenReqMints().filter((m) => !workflowMintSet.has(m));
      if (!reqMints.length) return fail('Pick at least one skill this workflow requires.');
      if (reqMints.length > 16) return fail('A workflow can require at most 16 skills.');
      // Synthesize the SKILL.md so the current backend (frontmatter sniff) mints a workflow;
      // requiredSkills carries the chosen skill mints (base58) the on-chain gate checks.
      const fm = ['---', 'name: ' + name, 'description: ' + description.replace(/\\s*\\n\\s*/g, ' '),
                  'type: workflow', 'requiredSkills: [' + reqMints.join(', ') + ']'];
      if (category) fm.push('category: ' + category);
      if (hashtags.length) fm.push('hashtags: [' + hashtags.join(', ') + ']');
      text = fm.concat(['---', '', '# ' + name, '', description, '']).join('\\n');
    } else {
      text = document.getElementById('pubText').value.trim();
      if (!text) return fail('Skill text is required.');
    }
    if (!priceSol) return fail('Enter a price in SOL (use 0 for free).');
    if (!/^\\d+(\\.\\d+)?$/.test(priceSol)) return fail('Price must be a number in SOL (e.g. 0.1).');
    pubSubmit.disabled = true; pubSubmit.textContent = 'Publishing…';
    const msg = {
      type: 'publishSkill', name, description, text, priceSol,
      category: category || undefined,
      hashtags: hashtags.length ? hashtags : undefined,
      image: image || undefined,
    };
    if (pubKind === 'workflow') { msg.kind = 'workflow'; msg.requiredSkills = reqMints; }
    vscode.postMessage(msg);
  });

  // ---- skeleton loaders ----
  // Footprints mirror the real cards so swapping skeleton -> content does not jump.
  // skSd fills an SD-card grid (skills / workflows / profile skills); skAc fills the
  // agent directory list; skId stands in for the profile id-card while it fetches.
  function skSd(n) { let s = ''; for (let i = 0; i < n; i++) s += '<div class="sk-sd sk-sh"></div>'; return s; }
  function skAc(n) { let s = ''; for (let i = 0; i < n; i++) s += '<div class="sk-ac sk-sh"></div>'; return s; }
  const skId = '<div class="sk-id sk-sh"></div>';

  // ---- agent directory + profile (issue #35) ----
  let currentProfileWallet = null;
  function openAgents() {
    document.getElementById('agentsList').innerHTML = skAc(4);
    vscode.postMessage({ type: 'listAgents' });
  }
  function showProfile(walletAddr) {
    currentProfileWallet = walletAddr;
    // paint the TARGET wallet immediately so the loading state never flashes the
    // previously-shown (own) wallet. self-only sections stay hidden until the
    // profile lands and tells us whether this wallet is ours.
    document.getElementById('wAvatarBig').innerHTML = avatarSvg(walletAddr);
    document.getElementById('walletAddr').textContent = walletAddr;
    document.getElementById('profileSubtitle').textContent = 'Loading profile…';
    document.getElementById('profileRep').innerHTML = '';
    document.getElementById('agentIdCard').innerHTML = skId;
    document.getElementById('profileSelfOnly2').style.display = 'none';
    document.getElementById('profileBody').innerHTML = '<div class="an-sd-grid">' + skSd(6) + '</div>';
    showView('wallet');
    vscode.postMessage({ type: 'getAgentProfile', wallet: walletAddr });
  }
  // ── issue #35: agent directory — cyberpunk cards (ported from the mobile .an-ac) ──
  // The ONE tier axis is verified-work stars (copies deliberately don't buy a tier), with
  // the same --an-tier-* thresholds the profile gauge uses, so an agent reads the same tier
  // on their card and on their page.
  const AG_SEG = 12; // STARS gauge segment count
  const AG_TIERS = [
    { name: 'Legendary', min: 250 },
    { name: 'Gold', min: 60 },
    { name: 'Silver', min: 15 },
    { name: 'Bronze', min: 3 },
  ];
  function agStarTier(stars) { return AG_TIERS.find((t) => stars >= t.min) || null; }
  function agNextTierMin(stars) {
    const asc = AG_TIERS.slice().sort((a, b) => a.min - b.min); // bronze..legendary
    const up = asc.find((t) => t.min > stars);
    return up ? up.min : asc[asc.length - 1].min;
  }
  // One stable accent per identity (mobile derives it from the avatar's hue). hashSeed comes
  // from the avatar script injected above, so the same wallet always gets the same accent.
  function agAccent(wallet) { return 'hsl(' + (hashSeed(wallet || 'default') % 360) + ' 46% 62%)'; }
  function agShort(w) { return w.slice(0, 6) + '...' + w.slice(-4); }

  function agentCardEl(agent, self) {
    const stars = agent.stars || 0;
    const tier = agStarTier(stars);
    const isMax = tier && tier.name === 'Legendary';
    const denom = agNextTierMin(stars);
    const filled = Math.max(0, Math.min(AG_SEG, Math.round((stars / denom) * AG_SEG)));
    const tierName = (tier ? tier.name : 'Unranked').toUpperCase();
    const created = agent.skillsPublished || 0;
    const copies = agent.totalSupply || 0;
    const earnedSol = agent.totalEarned ? Number(agent.totalEarned) / 1e9 : 0;
    const earned = earnedSol >= 100 ? earnedSol.toFixed(0) : earnedSol.toFixed(2);
    const sig = 34 + (agent.wallet.charCodeAt(2) % 6) * 11; // decorative battery fill
    let segs = '';
    for (let i = 0; i < AG_SEG; i++) segs += '<i class="' + (i < filled ? 'on' : '') + '"></i>';
    // wallet addresses are base58 (no HTML-special chars), so direct interpolation is safe.
    const btn = document.createElement('button');
    btn.className = 'an-ac' + (self ? ' is-self' : '');
    btn.style.setProperty('--accent', agAccent(agent.wallet));
    btn.innerHTML =
      '<div class="an-ac-in">' +
        '<div class="an-ac-top">' +
          '<span class="an-ac-hand">&gt;' + agShort(agent.wallet).toUpperCase() + '_AGENT' + (self ? '<span class="an-ac-you"> // YOU</span>' : '') + '</span>' +
          '<span class="an-ac-sig">SIGNAL <span class="an-ac-batt"><i style="width:' + sig + '%"></i></span></span>' +
        '</div>' +
        '<div class="an-ac-namerow">' +
          '<div><div class="an-ac-kana">エージェント</div><div class="an-ac-name">' + agent.wallet.slice(0, 6).toUpperCase() + '</div></div>' +
          '<div class="an-ac-access">アクセス / ACCESS<br><span class="an-ac-tier' + (tier ? '' : ' unranked') + '">' + tierName + '</span></div>' +
        '</div>' +
        '<div class="an-ac-body">' +
          '<div class="an-ac-ava">' + avatarSvg(agent.wallet) + '</div>' +
          '<div class="an-ac-attr">' +
            '<div><div class="an-ac-rank">&mdash; RANKING &mdash;</div>' +
              '<div class="an-ac-gauge"><span class="lab">STARS</span><span class="an-ac-segs">' + segs + '</span>' +
              '<span class="val">' + (isMax ? stars : stars + '/' + denom) + '</span></div></div>' +
            '<div class="an-ac-stats">' +
              '<div class="an-ac-stat"><div class="k">CREATED</div><div class="v">' + created + '</div></div>' +
              '<div class="an-ac-stat"><div class="k">COPIES</div><div class="v">' + copies + '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="an-ac-foot"><span class="an-ac-box"></span><span>&gt;EARNED <span class="earn">' + earned + '&#9678;</span></span><span class="an-ac-box"></span></div>' +
      '</div>';
    btn.addEventListener('click', () => showProfile(agent.wallet));
    return btn;
  }

  let lastAgents = [];
  function renderAgents(agents) {
    lastAgents = agents || [];
    // your own agent pinned at the top: from the leaderboard if it ranks, else a zero-stat
    // placeholder so "me" is always present and tappable (the profile fills in real stats).
    const selfEl = document.getElementById('agentsSelf');
    if (selfEl) {
      selfEl.innerHTML = '';
      if (myWalletAddress) {
        const selfRep = lastAgents.find((a) => a.wallet === myWalletAddress) ||
          { wallet: myWalletAddress, skillsPublished: 0, totalSupply: 0, notesReceived: 0, updatedAt: 0 };
        selfEl.appendChild(agentCardEl(selfRep, true));
      }
    }
    const search = document.getElementById('agentSearch');
    if (search && !search._wired) { search._wired = true; search.addEventListener('input', renderAgentsList); }
    renderAgentsList();
  }
  function renderAgentsList() {
    const el = document.getElementById('agentsList');
    if (!el) return;
    const searchEl = document.getElementById('agentSearch');
    const ql = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
    let others = lastAgents.filter((a) => a.wallet !== myWalletAddress);
    if (ql) others = others.filter((a) => a.wallet.toLowerCase().includes(ql));
    el.innerHTML = '';
    if (!others.length) {
      const e = document.createElement('div'); e.className = 'agEmpty';
      e.textContent = ql ? 'No agent matches that wallet' : 'No other agents yet';
      el.appendChild(e); return;
    }
    others.forEach((a) => el.appendChild(agentCardEl(a, false)));
  }
  // Optimistic blog/comment posts. On-chain note reads lag a few seconds, so the
  // profile the host re-pushes right after posting won't include the new note yet —
  // without this the post would silently vanish ("I wrote it but nothing happened").
  // We hold the just-posted note here and merge it in on every render until the real
  // read catches up (deduped by author+text), pruning anything older than 60s.
  let recentlyPosted = []; // [{ wallet, note, ts }]
  let pendingPost = null;  // { wallet, text, gitLink, self } — stashed at submit for agentNoteResult
  let postFeedback = null; // { wallet, text, ok, ts } — survives the immediate profile re-render
  // Active profile tab — persisted across renders so the post-and-re-push (which rebuilds
  // the whole pane) doesn't yank the user from Notes back to Skills ("bounce to top").
  let profileTab = 'agent';
  function mergeOptimistic(profile) {
    const now = Date.now();
    recentlyPosted = recentlyPosted.filter((p) => now - p.ts < 60000);
    const real = new Set((profile.threads || []).flatMap((t) => [t.note, ...(t.replies || [])]).map((n) => (n.author || '') + ' ' + (n.text || '')));
    // drop optimistic notes the real read now includes (self-heal)
    recentlyPosted = recentlyPosted.filter((p) => !(p.wallet === profile.wallet && real.has((p.note.author || '') + ' ' + (p.note.text || ''))));
    const pending = recentlyPosted.filter((p) => p.wallet === profile.wallet && !p.note.parentId).map((p) => p.note);
    return pending.length ? { ...profile, threads: [...pending.map((note) => ({ note, replies: [] })), ...(profile.threads || [])] } : profile;
  }
  function feedbackFor(wallet) {
    if (!postFeedback) return null;
    if (postFeedback.wallet !== wallet) return null;
    if (Date.now() - postFeedback.ts > 8000) {
      postFeedback = null;
      return null;
    }
    return postFeedback;
  }
  // Click-and-drag horizontal scrolling for the blog carousel. Mouse only — touch
  // already scrolls natively. Pointer capture keeps the drag alive past the element's
  // edge without leaking window listeners (handlers are scoped to el, GC'd on re-render).
  // A drag past 3px swallows the trailing click so card tx/git links don't fire mid-drag.
  function enableDragScroll(el) {
    let startX = 0, startLeft = 0, dragging = false, moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true; moved = false; startX = e.clientX; startLeft = el.scrollLeft;
      try { el.setPointerCapture(e.pointerId); } catch {}
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = startLeft - dx;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false; el.classList.remove('dragging');
      try { el.releasePointerCapture(e.pointerId); } catch {}
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
  }
  // Mirror of packages/core/src/links/github.ts (the React surface imports that module;
  // this browser-script copy can't). Keep the protocol allowlist + github.com host check
  // in sync with the source of truth there — security depends on both matching.
  function safeExternalUrl(raw) {
    try {
      const u = new URL(raw);
      if (/^https?:|^git:/.test(u.protocol)) return u.href;
    } catch {}
    return null;
  }
  function parseGithubLink(raw) {
    const href = safeExternalUrl(raw);
    if (!href) return null;
    let u;
    try { u = new URL(href); } catch { return null; }
    const host = u.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0], repo = parts[1].replace(/\\.git$/i, '');
    const full = owner + '/' + repo;
    const section = parts[2], value = parts[3], rest = parts.slice(4);
    if (!section) return { href, kind: 'Repo', label: full, meta: 'GitHub repository' };
    if (section === 'pull' && /^\\d+$/.test(value || '')) return { href, kind: 'PR', label: full + ' #' + value, meta: 'GitHub pull request' };
    if (section === 'commit' && /^[0-9a-f]{7,40}$/i.test(value || '')) return { href, kind: 'Commit', label: full + '@' + value.slice(0, 7), meta: 'GitHub commit' };
    if (section === 'blob' && value && rest.length) return { href, kind: 'File', label: rest.join('/'), meta: full };
    return null;
  }
  function gitLinkNode(raw, className) {
    const gh = parseGithubLink(raw);
    const wrap = document.createElement('div'); wrap.className = className;
    if (gh) {
      const a = document.createElement('a'); a.className = 'gh-card'; a.href = gh.href;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      const kind = document.createElement('span'); kind.className = 'gh-kind'; kind.textContent = gh.kind;
      const title = document.createElement('span'); title.className = 'gh-title'; title.textContent = gh.label;
      const meta = document.createElement('span'); meta.className = 'gh-meta'; meta.textContent = gh.meta;
      a.appendChild(kind); a.appendChild(title); a.appendChild(meta); wrap.appendChild(a);
      return wrap;
    }
    const safeLink = safeExternalUrl(raw);
    if (!safeLink) return null;
    const a = document.createElement('a'); a.href = safeLink; a.textContent = safeLink;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; wrap.appendChild(a);
    return wrap;
  }
  // ── issue #35: agent PROFILE hero — .an-id ID card + verified-work folders (mobile parity) ──
  // Same verified-work star tiers (3/15/60/250) the directory cards use, so an agent reads the
  // same tier on the card and the profile. Tier colours come from the shared --an-tier-* tokens.
  const PROF_TIERS = [ { name: 'Bronze', min: 3 }, { name: 'Silver', min: 15 }, { name: 'Gold', min: 60 }, { name: 'Legendary', min: 250 } ];
  const TIER_COLOR = { Bronze: 'var(--an-tier-bronze)', Silver: 'var(--an-tier-silver)', Gold: 'var(--an-tier-gold)', Legendary: 'var(--an-tier-legendary)' };
  const PROF_SEG = 15;
  function profTierInfo(stars) {
    let cur = null, next = null;
    for (const t of PROF_TIERS) { if (stars >= t.min) cur = t; else { next = t; break; } }
    return { cur: cur, next: next };
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function renderAgentIdCard(profile) {
    const el = document.getElementById('agentIdCard');
    if (!el) return;
    const wallet = profile.wallet;
    const rep = profile.reputation || {};
    const repoStars = (profile.verifiedRepos || []).reduce((s, r) => s + (r.stars || 0), 0);
    const ti = profTierInfo(repoStars);
    const curName = (ti.cur && ti.cur.name) || (ti.next && ti.next.name) || 'Bronze';
    const tierColor = TIER_COLOR[curName] || 'var(--an-tier-bronze)';
    const prevMin = ti.cur ? ti.cur.min : 0;
    const bandPct = ti.next ? Math.min(100, Math.max(0, ((repoStars - prevMin) / (ti.next.min - prevMin)) * 100)) : 100;
    const litSegs = Math.round((bandPct / 100) * PROF_SEG);
    const starsFrac = ti.next ? (repoStars + '/' + ti.next.min) : 'MAX';
    const stats = [['CREATED', pad2((profile.createdSkills || []).length)], ['COPIES', pad2(rep.totalSupply || 0)], ['OWNED', pad2((profile.ownedSkills || []).length)]];
    let statsHtml = '';
    stats.forEach((s) => { statsHtml += '<div class="an-id-bigstat"><span class="k">' + s[0] + '</span><span class="lead"></span><span class="v">' + s[1] + '</span></div>'; });
    let rungs = '';
    PROF_TIERS.forEach((t) => { const isCur = t.name === curName; const done = repoStars >= t.min && !isCur; rungs += '<div class="an-id-rung' + (isCur ? ' cur' : done ? ' done' : '') + '">' + t.name.toUpperCase() + '</div>'; });
    let segs = '';
    for (let i = 0; i < PROF_SEG; i++) segs += '<i class="' + (i < litSegs ? 'on' : '') + '"></i>';
    el.innerHTML =
      '<div class="an-id" style="--tier:' + tierColor + '"><div class="an-id-in">' +
        '<div class="an-id-namerow"><div style="min-width:0"><div class="an-id-role">AGENT</div>' +
          '<div class="an-id-name">' + wallet.slice(0, 6) + '</div></div>' +
          '<div class="an-id-tail">…' + wallet.slice(-4) + '<br>' + (profile.self ? 'YOUR AGENT' : 'AGENT PROFILE') + '</div></div>' +
        '<div class="an-id-body"><div class="an-id-ava">' + avatarSvg(wallet) + '<span class="tag">ID//' + wallet.slice(0, 4) + '</span></div>' +
          '<div class="an-id-info">' + statsHtml + '</div></div>' +
        '<div class="an-id-ladder"><span class="lab">TIER</span><div class="an-id-rungs">' + rungs + '</div></div>' +
        '<div class="an-id-gauge"><span class="lab">STARS</span><span class="an-id-segs">' + segs + '</span><span class="val">' + starsFrac + '</span></div>' +
      '</div></div>';
  }
  // Per-repo tier ramp (3/10/50/250) — drives the folder screen tint, star colour, gauge fill.
  const PROF_REPO_TIERS = [
    { min: 250, color: '#86c4cf', from: '#131a1b', to: '#0d1011', empty: '#1e2628' },
    { min: 50,  color: '#d8c074', from: '#1a1813', to: '#100f0d', empty: '#2a2618' },
    { min: 10,  color: '#b8c0cc', from: '#161719', to: '#0e0f10', empty: '#26282c' },
    { min: 3,   color: '#b8895a', from: '#1a1613', to: '#100f0e', empty: '#2a2420' },
  ];
  const PROF_REPO_BASE = { color: '#9a9a9a', from: '#1a1a1d', to: '#0d0d0e', empty: '#33333a' };
  function profRepoTier(stars) { return PROF_REPO_TIERS.find((t) => stars >= t.min) || PROF_REPO_BASE; }
  function profRepoFill(stars) { const next = [3, 10, 50, 250].find((t) => stars < t); if (!next) return 10; return Math.max(0, Math.min(10, Math.round((stars / next) * 10))); }
  const GH_MARK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="22" style="color:#cfcfcf"><path d="M12 1.5A10.5 10.5 0 0 0 8.68 22c.52.1.71-.23.71-.5v-1.76c-2.92.64-3.54-1.41-3.54-1.41-.48-1.21-1.16-1.53-1.16-1.53-.95-.65.07-.64.07-.64 1.05.07 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.88 1.07a10 10 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.45.21 2.52.1 2.79.68.74 1.08 1.67 1.08 2.82 0 4.02-2.46 4.9-4.8 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.72.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>';
  const FOLDER_BINARY = '01010100101010100101001010101001010010110100101010010101001010010101001010010110101001010010100100101001010101001010';
  // Verified-work folders (GitHub repos). Returns an HTML fragment so the Agent tab can
  // build it fresh each render inside the pane (profileBody is wiped on every renderProfile).
  function verifiedWorkHtml(profile) {
    const repos = (profile.verifiedRepos || []).slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
    if (!repos.length) return '';
    let cards = '';
    repos.forEach((r) => {
      const stars = r.stars || 0;
      const tier = profRepoTier(stars);
      const fill = profRepoFill(stars);
      let gauge = '';
      for (let i = 0; i < 10; i++) gauge += '<i class="' + (i < fill ? 'on' : '') + '"></i>';
      const url = (r.url || '').slice(0, 4) === 'http' ? r.url : '';
      const ghBtn = url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open repository">' + GH_MARK_SVG + '</a>' : GH_MARK_SVG;
      cards +=
        '<div class="an-tfolder" style="--c:' + tier.color + ';--e:' + tier.empty + '">' +
          '<div class="an-tfolder-clip"><div class="an-tfolder-screen" style="background:radial-gradient(120% 100% at 50% 22%, ' + tier.from + ' 0%, ' + tier.to + ' 70%)">' +
            '<div class="an-tfolder-bin">' + FOLDER_BINARY + '</div>' +
            '<div class="an-tfolder-label">&gt;VERIFIED_REPO</div>' +
            '<div class="an-tfolder-owner">' + escapeHtml(r.owner || '') + '<span style="color:#5a5a5d">/</span></div>' +
            '<div class="an-tfolder-name"><span style="color:var(--c)">&gt;</span><span class="an-tfolder-name-t">' + escapeHtml(r.name || '') + '</span>' + ghBtn + '</div>' +
            '<div class="an-tfolder-foot"><span></span><span class="an-tfolder-stars"><span class="an-tfolder-stars-n">' + stars + '★</span><span class="an-tfolder-gauge">' + gauge + '</span></span></div>' +
          '</div></div>' +
        '</div>';
    });
    return '<div class="pr-sec" style="margin-top:14px">Verified work</div><div class="an-vwork">' + cards + '</div>';
  }

  // ── GitHub verified-work registration (issue #93 parity) ──
  // Own-profile "+ Register GitHub work" opens this modal: a token form when none is saved
  // (the token stays on the host, never in the webview), then a repo form (owner/name + which
  // owned skills it backs). getGithubStatus / submitGithubToken / registerWorkRepo round-trip
  // to the host (session.ts), which defers to core (rpc.ts + verifiedWork.ts).
  let repoModalEl = null;
  function closeRepoRegister() { if (repoModalEl) { repoModalEl.remove(); repoModalEl = null; } }
  function openRepoRegister() {
    closeRepoRegister();
    const ov = document.createElement('div'); ov.className = 'skModal'; ov.id = 'repoModal';
    ov.addEventListener('click', (e) => { if (e.target === ov) closeRepoRegister(); });
    const card = document.createElement('div'); card.className = 'skModal-card';
    card.innerHTML =
      '<button class="skModal-close" title="Close">\\u00d7</button>'
      + '<div class="rr-title">Register GitHub work</div>'
      + '<div class="rr-body"><div class="rr-hint">Loading…</div></div>';
    ov.appendChild(card); document.body.appendChild(ov);
    card.querySelector('.skModal-close').addEventListener('click', closeRepoRegister);
    repoModalEl = ov;
    vscode.postMessage({ type: 'getGithubStatus' });
  }
  function renderRepoModalBody(status) {
    if (!repoModalEl) return;
    const body = repoModalEl.querySelector('.rr-body'); if (!body) return;
    body.innerHTML = '';
    if (!status || !status.hasToken) {
      // no token yet: capture one (repo scope). password field so it isn't shoulder-read.
      const p = document.createElement('div'); p.className = 'rr-hint';
      p.textContent = 'Add a GitHub token (repo scope) to register your work. Stored locally on this device, never synced.';
      const inp = document.createElement('input'); inp.type = 'password'; inp.className = 'rr-input';
      inp.placeholder = 'ghp_… (GitHub personal access token)';
      const link = document.createElement('a'); link.className = 'rr-link';
      link.href = 'https://github.com/settings/tokens/new?scopes=repo&description=AgentNet';
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Create a token ↗';
      const err = document.createElement('div'); err.className = 'rr-err';
      const btn = document.createElement('button'); btn.className = 'rr-btn'; btn.textContent = 'Save token';
      btn.addEventListener('click', () => {
        const t = inp.value.trim(); if (!t) return;
        btn.disabled = true; btn.textContent = 'Saving…'; err.style.display = 'none';
        vscode.postMessage({ type: 'submitGithubToken', token: t });
      });
      body.appendChild(p); body.appendChild(inp); body.appendChild(link); body.appendChild(err); body.appendChild(btn);
    } else {
      // token present: register an owner/name repo, optionally linking owned on-chain skills.
      const p = document.createElement('div'); p.className = 'rr-hint';
      p.textContent = 'Register a public GitHub repo as verified work' + (status.masked ? ' (token ' + status.masked + ')' : '') + '.';
      const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'rr-input';
      inp.placeholder = 'owner/name or github.com URL';
      body.appendChild(p); body.appendChild(inp);
      const owned = ownedSkills.filter((n) => !!skillMints[n]);
      const checks = [];
      if (owned.length) {
        const lbl = document.createElement('div'); lbl.className = 'rr-sublabel'; lbl.textContent = 'Link skills (optional)';
        body.appendChild(lbl);
        const list = document.createElement('div'); list.className = 'rr-skills';
        owned.forEach((n) => {
          const row = document.createElement('label'); row.className = 'rr-skill';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = skillMints[n];
          const nm = document.createElement('span'); nm.textContent = n;
          row.appendChild(cb); row.appendChild(nm); list.appendChild(row); checks.push(cb);
        });
        body.appendChild(list);
      }
      const err = document.createElement('div'); err.className = 'rr-err';
      const btn = document.createElement('button'); btn.className = 'rr-btn'; btn.textContent = 'Register repo';
      btn.addEventListener('click', () => {
        const repo = inp.value.trim();
        if (!repo) { err.textContent = 'Enter a repo (owner/name).'; err.style.display = ''; return; }
        const mints = checks.filter((c) => c.checked).map((c) => c.value);
        btn.disabled = true; btn.textContent = 'Registering…'; err.style.display = 'none';
        vscode.postMessage({ type: 'registerWorkRepo', repo: repo, skillMints: mints });
      });
      body.appendChild(err); body.appendChild(btn);
    }
  }

  function renderProfile(profile) {
    profile = mergeOptimistic(profile);
    const self = profile.self;
    const wallet = profile.wallet;
    // self-only section (disconnect) only shows on your own profile. Storage moved to the
    // wallet dropdown only (removed from the profile page to avoid duplication).
    document.getElementById('profileSelfOnly2').style.display = self ? '' : 'none';

    // ── hero: the .an-id ID card (verified work now lives in the Agent tab below) ──
    renderAgentIdCard(profile);

    const body = document.getElementById('profileBody');
    body.innerHTML = '';

    // ── tabs: Agent / Community (full-width flat underline + kana, ported from mobile) ──
    const tabs = document.createElement('div'); tabs.className = 'pr-tabs';
    const tabAgent = document.createElement('button'); tabAgent.className = 'pr-tab on';
    tabAgent.innerHTML = '<div class="t">Agent</div><div class="k">エージェント</div>';
    const tabCommunity = document.createElement('button'); tabCommunity.className = 'pr-tab';
    tabCommunity.innerHTML = '<div class="t">Community</div><div class="k">コミュニティ</div>';
    tabs.appendChild(tabAgent); tabs.appendChild(tabCommunity);
    body.appendChild(tabs);
    const paneAgent = document.createElement('div');
    const paneCommunity = document.createElement('div'); paneCommunity.style.display = 'none';
    body.appendChild(paneAgent); body.appendChild(paneCommunity);
    function selectTab(which) {
      const onAgent = which === 'agent';
      profileTab = onAgent ? 'agent' : 'community'; // remember across re-renders
      tabAgent.classList.toggle('on', onAgent); tabCommunity.classList.toggle('on', !onAgent);
      paneAgent.style.display = onAgent ? '' : 'none'; paneCommunity.style.display = onAgent ? 'none' : '';
    }
    tabAgent.addEventListener('click', () => selectTab('agent'));
    tabCommunity.addEventListener('click', () => selectTab('community'));

    // ── AGENT pane leads with verified work (GitHub folders), then skills — mobile order ──
    // own profile gets a "Register GitHub work" entry (issue #93 parity) above the folders.
    if (self) {
      const rr = document.createElement('button'); rr.className = 'pr-repo-add';
      rr.textContent = '+ Register GitHub work';
      rr.addEventListener('click', openRepoRegister);
      paneAgent.appendChild(rr);
    }
    const vwHtml = verifiedWorkHtml(profile);
    if (vwHtml) { const vw = document.createElement('div'); vw.innerHTML = vwHtml; paneAgent.appendChild(vw); }

    // ── helper: pretty skill card (click body → popup; Buy stops propagation) ──
    function skillCard(card) {
      // On another agent's profile a skill you already hold reads muted (dim); your own profile
      // shows everything at full strength. The card opens the skill modal (which carries Buy).
      const owned = self || ownedSkills.indexOf(card.name) >= 0;
      return skillSdCard(card, { owned: owned, dim: owned && !self, onOpen: (c) => openSkillModal(c.id) });
    }

    // ── SKILLS pane: created (with buy-all) + owned ──
    if (profile.createdSkills.length) {
      const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Created skills';
      paneAgent.appendChild(sec);
      if (!self) {
        const notOwned = profile.createdSkills.filter(c => ownedSkills.indexOf(c.name) < 0).length;
        if (notOwned > 0) {
          const buyAll = document.createElement('button'); buyAll.className = 'pr-buyall';
          buyAll.textContent = 'Buy all · ' + notOwned + ' not owned';
          buyAll.addEventListener('click', () => showBuyAllConfirm(profile));
          paneAgent.appendChild(buyAll);
        }
      }
      const cg = document.createElement('div'); cg.className = 'an-sd-grid';
      profile.createdSkills.forEach(c => cg.appendChild(skillCard(c)));
      paneAgent.appendChild(cg);
    }
    const ownedNotCreated = profile.ownedSkills.filter(o => !profile.createdSkills.some(c => c.id === o.id));
    if (ownedNotCreated.length) {
      const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Owned skills';
      paneAgent.appendChild(sec);
      const og = document.createElement('div'); og.className = 'an-sd-grid';
      ownedNotCreated.forEach(o => og.appendChild(skillCard(o)));
      paneAgent.appendChild(og);
    }
    if (!profile.createdSkills.length && !ownedNotCreated.length && !vwHtml) {
      const e = document.createElement('div'); e.className = 'pr-empty'; e.textContent = 'No work or skills yet.'; paneAgent.appendChild(e);
    }

    // ── helper: a note/comment card (date + on-chain tx link in the footer) ──
    // __txSignature / __blockTime are attached per-row by the gateway and flow through
    // hydrateNotes' spread, so historical cards link to their exact write tx. A freshly
    // posted (optimistic) card has only a timestamp until the on-chain read catches up.
    function fmtNoteDate(n) {
      const ms = n.__blockTime ? n.__blockTime * 1000 : (n.timestamp || 0);
      if (!ms) return '';
      try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
      catch { return ''; }
    }
    function explorerTxUrl(sig) {
      const u = 'https://explorer.solana.com/tx/' + encodeURIComponent(sig);
      return rpcNetwork === 'mainnet' ? u : u + '?cluster=' + encodeURIComponent(rpcNetwork);
    }
    function noteCard(n, withAuthor) {
      const el = document.createElement('div'); el.className = 'pr-note';
      if (withAuthor) {
        const auth = document.createElement('div'); auth.className = 'pr-note-author';
        auth.textContent = n.author ? (n.author.slice(0, 6) + '…' + n.author.slice(-4)) : '?';
        el.appendChild(auth);
      }
      const bodyEl = document.createElement('div'); bodyEl.className = 'pr-note-body'; renderMd(bodyEl, n.text || ''); el.appendChild(bodyEl);
      if (n.gitLink) {
        const gl = gitLinkNode(n.gitLink, 'pr-note-git');
        if (gl) el.appendChild(gl);
      }
      const date = fmtNoteDate(n);
      const sig = typeof n.__txSignature === 'string' ? n.__txSignature : null;
      if (date || sig) {
        const foot = document.createElement('div'); foot.className = 'pr-note-foot';
        const d = document.createElement('span'); d.className = 'pr-note-date'; d.textContent = date;
        foot.appendChild(d);
        if (sig) {
          const a = document.createElement('a'); a.className = 'pr-note-tx';
          a.href = explorerTxUrl(sig); a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = 'tx ↗'; a.title = sig;
          foot.appendChild(a);
        }
        el.appendChild(foot);
      }
      return el;
    }

    // ── NOTES pane: blog (self-notes) + compose (own) + comments ──
    // Threads arrive pre-grouped from the host (GH #101). Blog = the agent's own posts;
    // comment threads = holder threads with replies flattened to the 2-level cap.
    const allThreads = profile.threads || [];
    const selfNotes = allThreads.filter(t => t.note.isSelfNote).map(t => t.note);
    if (selfNotes.length) {
      const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Blog';
      paneCommunity.appendChild(sec);
      const blog = document.createElement('div'); blog.className = 'pr-blog';
      blog.tabIndex = 0; blog.setAttribute('role', 'list'); blog.setAttribute('aria-label', 'Blog posts');
      blog.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        blog.scrollBy({ left: e.key === 'ArrowRight' ? 260 : -260, behavior: 'smooth' });
      });
      selfNotes.forEach(n => blog.appendChild(noteCard(n, false)));
      enableDragScroll(blog);
      paneCommunity.appendChild(blog);
    }
    // Compose box — ALWAYS shown so the action is discoverable. Self → post to blog;
    // otherwise → write a comment, enabled only when the connected wallet holds ≥1 of
    // this agent's skills (profile.canComment, same on-chain gate as the host). When it
    // can't, the box is disabled with a hint rather than hidden.
    {
      const canPost = self || !!profile.canComment;
      const feedback = feedbackFor(wallet);
      const sec = document.createElement('div'); sec.className = 'pr-sec';
      sec.innerHTML = self ? 'FORM // <b>POST TO BLOG</b>' : 'FORM // <b>WRITE A COMMENT</b>';
      paneCommunity.appendChild(sec);
      const compose = document.createElement('div'); compose.className = 'pr-compose';
      // blog posts (self) carry an optional Title; comments do not — matches the mobile composer.
      let titleInput = null;
      if (self) {
        titleInput = document.createElement('input'); titleInput.type = 'text';
        titleInput.placeholder = 'Title (optional)';
      }
      const ta = document.createElement('textarea');
      ta.placeholder = self ? 'Write a blog post or update…' : 'Share your experience with this agent…';
      // optional image: an http link, an on-chain address, or a tx id (same as mobile).
      const imgInput = document.createElement('input'); imgInput.type = 'text';
      imgInput.placeholder = 'Image link / on-chain address / tx id (optional)';
      const gitInput = document.createElement('input'); gitInput.type = 'text'; gitInput.placeholder = 'GitHub / git URL (optional)';
      const errEl = document.createElement('div'); errEl.className = 'pr-err';
      if (feedback) {
        errEl.textContent = feedback.text;
        errEl.style.display = '';
        if (feedback.ok) errEl.classList.add('ok');
      }
      const btn = document.createElement('button'); btn.textContent = self ? 'Post' : 'Comment';
      if (!canPost) {
        ta.disabled = true; gitInput.disabled = true; imgInput.disabled = true; btn.disabled = true;
        if (titleInput) titleInput.disabled = true;
        const hint = document.createElement('div'); hint.className = 'pr-hint';
        hint.textContent = 'Own ≥1 of this agent’s skills to comment.';
        compose.appendChild(hint);
      }
      btn.addEventListener('click', () => {
        const text = ta.value.trim(); if (!text) return;
        const gitLink = gitInput.value.trim() || undefined;
        const image = imgInput.value.trim() || undefined;
        const title = titleInput ? (titleInput.value.trim() || undefined) : undefined;
        postFeedback = null;
        btn.disabled = true; btn.textContent = self ? 'Posting…' : 'Commenting…'; errEl.style.display = 'none'; errEl.classList.remove('ok');
        pendingPost = { wallet, text, gitLink, self };
        const out = { type: 'postAgentNote', agentWallet: wallet, text, gitLink };
        if (image) out.image = image;
        if (title) out.title = title;
        vscode.postMessage(out);
      });
      if (titleInput) compose.appendChild(titleInput);
      compose.appendChild(ta); compose.appendChild(imgInput); compose.appendChild(gitInput);
      compose.appendChild(errEl); compose.appendChild(btn);
      paneCommunity.appendChild(compose);
      // stash refs for the agentNoteResult handler (success clears them + confirms)
      body._postBtn = btn; body._postErr = errEl; body._postLabel = self ? 'Post' : 'Comment';
      body._postTa = ta; body._postGit = gitInput; body._postImg = imgInput; body._postTitle = titleInput;
    }
    // Attach a Reply button + inline composer to a rendered comment card. parentId is the
    // id of the note being answered (the gateway flattens deeper replies under the same
    // top-level thread; parentId still records who was answered for the @author ref).
    const canReply = self || !!profile.canComment;
    function attachReply(cardEl, parentId) {
      if (!canReply) return;
      const bar = document.createElement('div'); bar.className = 'pr-replybar';
      const toggle = document.createElement('button'); toggle.className = 'pr-replybtn'; toggle.textContent = 'Reply';
      bar.appendChild(toggle); cardEl.appendChild(bar);
      let box = null;
      toggle.addEventListener('click', () => {
        if (box) { box.remove(); box = null; toggle.textContent = 'Reply'; return; }
        toggle.textContent = 'Cancel';
        box = document.createElement('div'); box.className = 'pr-compose pr-replycompose';
        const ta = document.createElement('textarea'); ta.placeholder = 'Write a reply…';
        const err = document.createElement('div'); err.className = 'pr-err';
        const send = document.createElement('button'); send.textContent = 'Reply';
        send.addEventListener('click', () => {
          const text = ta.value.trim(); if (!text) return;
          send.disabled = true; send.textContent = 'Replying…'; err.style.display = 'none';
          pendingPost = { wallet, text, parentId, self };
          vscode.postMessage({ type: 'postAgentNote', agentWallet: wallet, text, parentId });
        });
        box.appendChild(ta); box.appendChild(err); box.appendChild(send);
        cardEl.appendChild(box); ta.focus();
      });
    }

    const commentThreads = allThreads.filter(t => !t.note.isSelfNote);
    const commentCount = commentThreads.reduce((s, t) => s + 1 + (t.replies ? t.replies.length : 0), 0);
    if (commentThreads.length) {
      const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Comments (' + commentCount + ')';
      paneCommunity.appendChild(sec);
      commentThreads.forEach(t => {
        const opCard = noteCard(t.note, true);
        attachReply(opCard, t.note.id);
        paneCommunity.appendChild(opCard);
        (t.replies || []).forEach(rep => {
          const rc = noteCard(rep, true); rc.classList.add('pr-reply');
          if (rep.parentAuthor) {
            const to = document.createElement('div'); to.className = 'pr-replyto';
            to.textContent = '↳ replying to ' + agShort(rep.parentAuthor);
            rc.insertBefore(to, rc.firstChild);
          }
          attachReply(rc, rep.id);
          paneCommunity.appendChild(rc);
        });
      });
    } else {
      const e = document.createElement('div'); e.className = 'pr-empty';
      e.textContent = self ? 'No comments yet.' : 'No comments yet — be the first.';
      paneCommunity.appendChild(e);
    }

    // Restore the tab the user was on (default Agent). After posting, the host re-pushes
    // a fresh profile and we rebuild this whole pane — without this the user is yanked
    // from Community (where they just posted) back to Agent.
    selectTab(profileTab);
  }

  function showBuyAllConfirm(profile) {
    const notOwned = profile.createdSkills.filter(c => ownedSkills.indexOf(c.name) < 0);
    if (!notOwned.length) return;
    const totalLamports = notOwned.reduce((acc, c) => acc + (c.price ? BigInt(c.price) : 0n), 0n);
    const totalSol = totalLamports > 0n ? (Number(totalLamports) / 1e9).toFixed(4) + ' SOL' : 'free';
    const body = document.getElementById('profileBody');
    // replace buy-all button area with confirm panel
    const existing = body.querySelector('.pr-confirm');
    if (existing) { existing.remove(); return; }
    const confirm = document.createElement('div'); confirm.className = 'pr-confirm';
    const h = document.createElement('div'); h.style.fontWeight = '600'; h.textContent = 'Buy ' + notOwned.length + ' skill' + (notOwned.length !== 1 ? 's' : '') + ' (' + totalSol + ')';
    const ul = document.createElement('ul');
    notOwned.forEach(c => { const li = document.createElement('li'); li.textContent = c.name || c.id; ul.appendChild(li); });
    const btns = document.createElement('div'); btns.className = 'confirm-btns';
    const ok = document.createElement('button'); ok.className = 'pr-buyall'; ok.style.justifyContent = 'center'; ok.textContent = 'Confirm';
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
    ok.addEventListener('click', () => {
      ok.disabled = true; cancel.disabled = true; ok.textContent = 'Buying…';
      vscode.postMessage({ type: 'buyAllSkills', wallet: profile.wallet });
    });
    cancel.addEventListener('click', () => confirm.remove());
    btns.appendChild(ok); btns.appendChild(cancel);
    confirm.appendChild(h); confirm.appendChild(ul); confirm.appendChild(btns);
    // insert right after the Buy-all button (which lives in the Skills pane)
    const buyAllBtn = body.querySelector('.pr-buyall');
    if (buyAllBtn && buyAllBtn.parentNode) buyAllBtn.parentNode.insertBefore(confirm, buyAllBtn.nextSibling);
    else body.appendChild(confirm);
  }

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
  document.getElementById('walletPill').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(walletMenu, 'wallet');
    if (walletMenu.style.display !== 'none') vscode.postMessage({ type: 'getBalance' }); // refresh funds on open
  });
  document.getElementById('openWalletPage').addEventListener('click', () => { closeMenus(); if (myWalletAddress) showProfile(myWalletAddress); else showView('wallet'); });
  // click outside closes any open menu
  document.addEventListener('click', (e) => {
    closeMenus();
    if (inputWrap && !inputWrap.contains(e.target)) {
      slashMenu.style.display = 'none';
      activeSlashMatches = [];
    }
  });
  histMenu.addEventListener('click', (e) => e.stopPropagation());
  walletMenu.addEventListener('click', (e) => e.stopPropagation());

  // equipped-skills panel: inline toggle above the composer (not an absolute dropdown)
  const skillsBtn = document.getElementById('skillsBtn');
  const skillsPanel = document.getElementById('skillsPanel');
  function closeSkillsPanel() { skillsPanel.style.display = 'none'; skillsBtn.classList.remove('on'); }
  skillsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = skillsPanel.style.display !== 'none';
    skillsPanel.style.display = open ? 'none' : 'block';
    skillsBtn.classList.toggle('on', !open);
  });
  // explicit close (×) on the panel header — the panel was un-dismissable before
  const skillsCloseBtn = document.getElementById('skillsClose');
  if (skillsCloseBtn) skillsCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeSkillsPanel(); });

  // wallet-menu "Skills" entry → expand an INLINE, scrollable list of owned skills right
  // here in the dropdown. No buy / no page jump (purchases live in the Markets tab); just
  // "what do I own". Clicking again collapses it.
  const walletSkillsItem = document.getElementById('walletSkills');
  const walletSkillList = document.getElementById('walletSkillList');
  function renderWalletSkillList() {
    if (!walletSkillList) return;
    walletSkillList.innerHTML = '';
    if (!ownedSkills.length) {
      const e = document.createElement('div'); e.className = 'wskEmpty';
      e.textContent = 'No skills yet. Buy them in Markets.';
      walletSkillList.appendChild(e);
      return;
    }
    for (const name of ownedSkills) {
      const row = document.createElement('div'); row.className = 'wskRow';
      row.innerHTML = '<span class="wand">' + ${JSON.stringify(WAND_SVG)} + '</span>';
      const lbl = document.createElement('span'); lbl.textContent = name; lbl.title = name;
      row.appendChild(lbl); row.style.cursor = 'pointer';
      // NFT skills (have a mint) -> the market detail view, which has the comment box
      // (the popup modal doesn't). Bundled skills (no mint) -> the local SKILL.md doc.
      row.addEventListener('click', () => { const mt = skillMints[name]; if (mt) { showView('market'); openDetail(mt); } else openSkillDoc(name); });
      walletSkillList.appendChild(row);
    }
  }
  if (walletSkillsItem && walletSkillList) walletSkillsItem.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = walletSkillList.style.display !== 'none';
    if (open) { walletSkillList.style.display = 'none'; walletSkillsItem.classList.remove('open'); return; }
    renderWalletSkillList();
    walletSkillList.style.display = 'flex';
    walletSkillsItem.classList.add('open');
  });
  // The agent's OWNED skills (array of names) — everything owned is "active" (no
  // separate active state). Renders each as an item card in the panel; empty slots
  // fill the rest. No count badge (ownership is the whole point, not a number).
  // Build a skill as an "SD-card" collectible (ported from the React surface). One component
  // used everywhere skills are listed. card: { name, id, category?, type?, price?, supply? }.
  // opts: { owned, disposed, firing, dim, onOpen }. The whole card is the click target (opens
  // detail); buying happens there, so there is no inline buy button.
  function skillSdCard(card, opts) {
    opts = opts || {};
    const isWorkflow = card.type === 'workflow';
    const priceSol = (card.price && card.price !== '0' && card.price !== 0)
      ? (Number(card.price) / 1e9).toFixed(2) : null;
    const cat = String(card.category || (isWorkflow ? 'workflow' : 'skill')).toUpperCase().slice(0, 8);
    const ty = isWorkflow ? '/ FLOW' : '/ SKILL';
    const state = opts.disposed ? 'OFF' : opts.owned ? 'OWNED' : 'GET';
    const nm = card.name || card.id || '';
    const el = document.createElement('button');
    el.className = 'an-sd' + (isWorkflow ? ' is-workflow' : '') + (opts.disposed ? ' is-disposed' : '')
      + (opts.dim ? ' is-owned-dim' : '') + (opts.firing ? ' is-firing' : '');
    el.title = nm; el.setAttribute('data-skill', card.name || '');
    // sigil is our own deterministic SVG (name only seeds numbers) -> safe to inject as markup;
    // all human-readable fields go through textContent below so a skill name can't inject HTML.
    el.innerHTML =
      '<span class="an-sd-tab"></span>' +
      '<div class="an-sd-label">' +
        '<svg class="an-sd-art" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + skillSigilSvg(nm) + '</svg>' +
        '<span class="an-sd-bar" aria-hidden="true"></span>' +
        '<div class="an-sd-mark"><span class="cat"></span> <span class="ty"></span></div>' +
        '<div class="an-sd-name"></div>' +
        '<div class="an-sd-chip"><span class="an-sd-big"></span><span class="an-sd-meta"></span></div>' +
      '</div>';
    el.querySelector('.an-sd-mark .cat').textContent = cat;
    el.querySelector('.an-sd-mark .ty').textContent = ty;
    el.querySelector('.an-sd-name').textContent = nm;
    el.querySelector('.an-sd-big').textContent = (card.supply != null) ? String(card.supply) : '\\u2014';
    const meta = el.querySelector('.an-sd-meta');
    meta.textContent = priceSol ? (priceSol + '\\u25ce') : 'FREE';
    meta.appendChild(document.createElement('br'));
    meta.appendChild(document.createTextNode(state));
    // 2a gold star grade: summed GitHub stars of repos using this skill, corner brackets on the
    // right axis under the mark. Only when there are stars (0-star skills stay clean).
    const stars = Number(card.stars) || 0;
    if (stars > 0) {
      const grade = document.createElement('div');
      grade.className = 'an-sd-grade';
      const st = document.createElement('span'); st.className = 'st'; st.textContent = '\\u2605';
      grade.appendChild(st);
      grade.appendChild(document.createTextNode(String(stars)));
      el.querySelector('.an-sd-label').appendChild(grade);
    }
    if (opts.onOpen) el.addEventListener('click', () => opts.onOpen(card));
    return el;
  }

  function setSkills(names, mints) {
    names = names || [];
    // routing map includes disposed skills too, so clicking a greyed slot still opens its
    // detail (where Re-equip lives) and ownsMint() still treats it as owned (it is, on-chain).
    if (mints) skillMints = Object.assign({}, mints, disposedMints);
    const grid = document.getElementById('skillGrid');
    const status = document.getElementById('skillStatus');
    const n = names.length;
    const disposedSlugs = Object.keys(disposedMints);
    // "default" skills are the built-in bundled ones — no on-chain mint. The Hide-default
    // filter drops them from the grid so only owned collectibles show. Counts/badge stay full.
    const shown = hideDefaultSkills ? names.filter((nm) => !!skillMints[nm]) : names;
    const hidden = n - shown.length;
    // NOTE: do NOT light up "casting" here — owning a skill is not the same as using it.
    // The glow (panel/button/slot) is driven only by flashSkill when a skill actually fires.
    status.textContent = n
      ? (n === 1 ? '1 skill' : n + ' skills') + (hidden ? ' \\u00b7 ' + hidden + ' hidden' : '')
      : 'none yet';
    grid.innerHTML = '';
    for (const name of shown) {
      // Bought NFT skills have a mint -> open the market detail view (on-chain source, and it
      // carries the comment box — the popup modal doesn't). Bundled skills (no mint) fall back
      // to the local SKILL.md doc. Avoids the name!=slug 404 on disk.
      const open = () => { const mt = skillMints[name]; if (mt) { showView('market'); openDetail(mt); } else openSkillDoc(name); };
      grid.appendChild(skillSdCard({ name: name }, { owned: true, onOpen: open }));
    }
    // un-pinned skills: shown greyed + desaturated, still listed (not gone). Click opens the
    // detail view, which shows a Re-equip button for an owned-but-disposed skill.
    for (const name of disposedSlugs) {
      const c = skillSdCard({ name: name }, { owned: true, disposed: true,
        onOpen: () => { showView('market'); openDetail(disposedMints[name]); } });
      c.title = name + ' \\u2014 un-pinned (click to re-equip)';
      grid.appendChild(c);
    }
    const fill = Math.max(0, 3 - shown.length - disposedSlugs.length);
    for (let i = 0; i < fill; i++) { const s = document.createElement('div'); s.className = 'skSlot empty'; grid.appendChild(s); }
    ownedSkills = names;
    // mirror the owned count onto the wallet-menu Skills entry (badge hidden when 0)
    const wc = document.getElementById('walletSkillCount');
    if (wc) { wc.textContent = n ? String(n) : ''; wc.style.display = n ? '' : 'none'; }
    // keep the inline wallet list fresh if it's currently expanded
    const wsl = document.getElementById('walletSkillList');
    if (wsl && wsl.style.display !== 'none') renderWalletSkillList();
    // keep the workflow builder's required-skills picker fresh if it's currently open
    if (pubReqWrap && pubReqWrap.style.display !== 'none') renderPubReq();
  }
  let ownedSkills = [];
  let skillMints = {}; // slug/name -> mint for bought NFT skills (reuse market detail)
  let workflowMintSet = new Set(); // owned mints that are workflows (excluded from the workflow picker)
  let disposedMints = {}; // slug -> mint for un-pinned skills (greyed in the panel)
  let disposedMintSet = new Set(); // the mints above, for isDisposed() detail checks
  // small view prefs persist via the VSCode webview state; the browser fallback has no
  // state API, so these are guarded no-ops there (filter just resets to off on reload).
  function uiGet(k) { try { const s = vscode.getState && vscode.getState(); return s ? s[k] : undefined; } catch (e) { return undefined; } }
  function uiSet(k, v) { try { if (!vscode.setState) return; const s = (vscode.getState && vscode.getState()) || {}; s[k] = v; vscode.setState(s); } catch (e) {} }
  let hideDefaultSkills = !!uiGet('hideDefaultSkills');
  const hideDefaultCb = document.getElementById('skHideDefault');
  if (hideDefaultCb) {
    hideDefaultCb.checked = hideDefaultSkills;
    hideDefaultCb.addEventListener('change', () => {
      hideDefaultSkills = hideDefaultCb.checked;
      uiSet('hideDefaultSkills', hideDefaultSkills);
      setSkills(ownedSkills); // re-render with the full owned list; skillMints is already set
    });
  }
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
      // The inline panel shop shares the collectible language; the card opens the market
      // detail (where Buy lives), same as an owned slot.
      const owned = ownedSkills.indexOf(r.name) >= 0;
      skillResults.appendChild(skillSdCard(r, { owned: owned, dim: owned,
        onOpen: (c) => { showView('market'); openDetail(c.id); } }));
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

  // ---- Markets full-screen view (same contract, marketplace design) ----
  const mktSearch = document.getElementById('mktSearch');
  const mktResults = document.getElementById('mktResults');
  const mktListEl = document.getElementById('mktList');
  const mktDetailEl = document.getElementById('mktDetail');
  const mktDetailBody = document.getElementById('mktDetailBody');
  let lastMarketResults = []; // last search results, kept to re-render on owned-list change
  let currentKind = 'skill';  // active tab: Skills | Workflows
  let currentDetail = null;   // { id, type } of the open detail — for comments refresh
  // "Hide owned" market filter: default ON (uiGet is undefined on first run) so the grid
  // surfaces NEW skills, matching mobile. Persisted, so the choice sticks across reloads.
  let hideOwnedMarket = uiGet('hideOwnedMarket'); if (hideOwnedMarket === undefined) hideOwnedMarket = true;
  const mktHideOwnedCb = document.getElementById('mktHideOwned');
  if (mktHideOwnedCb) {
    mktHideOwnedCb.checked = hideOwnedMarket;
    mktHideOwnedCb.addEventListener('change', () => {
      hideOwnedMarket = mktHideOwnedCb.checked;
      uiSet('hideOwnedMarket', hideOwnedMarket);
      renderMarketResults(lastMarketResults);
    });
  }
  // Market ranking: 'supply' (popularity, indexer default) or 'stars' (summed GitHub
  // stars of repos that use the skill, GH #89). Persisted like the other market prefs.
  let mktSort = uiGet('mktSort') === 'stars' ? 'stars' : 'supply';
  const mktSortBtn = document.getElementById('mktSortBtn');
  function paintSortBtn() {
    if (!mktSortBtn) return;
    mktSortBtn.textContent = mktSort === 'stars' ? '\\u2605 Stars' : 'Popular';
    mktSortBtn.classList.toggle('stars', mktSort === 'stars');
  }
  paintSortBtn();
  if (mktSortBtn) mktSortBtn.addEventListener('click', () => {
    mktSort = mktSort === 'stars' ? 'supply' : 'stars';
    uiSet('mktSort', mktSort); paintSortBtn(); runMarketSearch();
  });
  function runMarketSearch() {
    mktResults.innerHTML = skSd(8);
    vscode.postMessage({ type: 'searchSkills', query: mktSearch.value.trim(), kind: currentKind, sort: mktSort });
  }
  function openMarket() {
    showMktList();
    // first open (and re-open) loads the popular list (empty query = supply-sorted)
    mktResults.innerHTML = skSd(8);
    vscode.postMessage({ type: 'searchSkills', query: '', kind: currentKind, sort: mktSort });
    vscode.postMessage({ type: 'ownedSkills' });
    vscode.postMessage({ type: 'getBalance' }); // show funds in the market header
  }
  function showMktList() { mktListEl.style.display = 'block'; mktDetailEl.style.display = 'none'; }
  function showMktDetail() { mktListEl.style.display = 'none'; mktDetailEl.style.display = 'block'; }
  document.getElementById('mktSearchBtn').addEventListener('click', runMarketSearch);
  document.getElementById('backToList').addEventListener('click', showMktList);
  mktSearch.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); runMarketSearch(); }
  });
  // Skills / Workflows tabs — switching re-runs the search filtered to that kind.
  for (const tab of document.querySelectorAll('.mktTab')) {
    tab.addEventListener('click', () => {
      currentKind = tab.getAttribute('data-kind');
      for (const t of document.querySelectorAll('.mktTab')) t.classList.toggle('on', t === tab);
      runMarketSearch();
    });
  }
  function openDetail(mint) {
    showMktDetail();
    mktDetailBody.innerHTML = '<div class="mktEmpty">Loading…</div>';
    vscode.postMessage({ type: 'getSkillDetail', mint });
  }

  // ---- skill popup (opened from a profile skill card) ----------------------
  // A modal overlay that reuses the .dt-* detail styles. Routed separately from
  // the market detail view via skillModalOpen so one getSkillDetail reply lands
  // in the right place.
  const skillModalEl = document.getElementById('skillModal');
  const skillModalBody = document.getElementById('skillModalBody');
  let skillModalOpen = false, skillModalBuyBtn = null, skillModalName = null, skillModalMint = null, skillDocOpen = false;
  function openSkillModal(mint) {
    skillModalOpen = true;
    skillModalBuyBtn = null; skillModalName = null; skillModalMint = null;
    skillModalBody.innerHTML = '<div class="mktEmpty">Loading…</div>';
    skillModalEl.style.display = 'flex';
    vscode.postMessage({ type: 'getSkillDetail', mint });
    // The panel may not have received an ownedSkills push yet (the modal opens from the
    // profile, not the market) — request one so refreshModalOwned can flip Buy → Owned
    // instead of offering to re-buy a soulbound skill we already hold.
    vscode.postMessage({ type: 'ownedSkills' });
  }
  function closeSkillModal() {
    skillModalOpen = false; skillDocOpen = false; skillModalBuyBtn = null; skillModalName = null; skillModalMint = null;
    skillModalEl.style.display = 'none';
  }
  // flip the modal's Buy → Owned once an ownedSkills refresh shows we now hold it
  function refreshModalOwned() {
    if (skillModalBuyBtn && (ownsMint(skillModalMint) || (skillModalName && ownedSkills.indexOf(skillModalName) >= 0))) {
      skillModalBuyBtn.disabled = true; skillModalBuyBtn.textContent = 'Owned';
    }
  }
  function renderSkillModal(detail) {
    const c = (detail && detail.card) || {};
    // Ownership is decided by MINT first, same as the market detail and the comment
    // gate (ownsMint) — name matching alone breaks for skills whose detail comes back
    // with name === mint, which is what offered Buy on an already-owned skill.
    const owned = ownsMint(c.id) || ownedSkills.indexOf(c.name) >= 0;
    skillModalName = c.name || null;
    skillModalMint = c.id || null;
    skillModalBody.innerHTML = '';
    const head = document.createElement('div'); head.className = 'dt-head';
    const img = document.createElement('div'); img.className = 'dt-img';
    img.innerHTML = '<span class="wand">' + ${JSON.stringify(IQ_LOGO_SVG)} + '</span>';
    const htxt = document.createElement('div');
    const kind = document.createElement('div'); kind.className = 'dt-kind'; kind.textContent = (c.type || 'skill');
    const nm = document.createElement('div'); nm.className = 'dt-name'; nm.textContent = c.name || c.id || '';
    htxt.appendChild(kind); htxt.appendChild(nm);
    head.appendChild(img); head.appendChild(htxt); skillModalBody.appendChild(head);
    if (c.description) { const d = document.createElement('div'); d.className = 'dt-desc'; d.textContent = c.description; skillModalBody.appendChild(d); }
    const meta = document.createElement('div'); meta.className = 'dt-meta';
    const addTag = (t) => { const s = document.createElement('span'); s.className = 'dt-tag'; s.textContent = t; meta.appendChild(s); };
    if (c.category) addTag(c.category);
    for (const h of (c.hashtags || [])) addTag('#' + h);
    if (typeof c.supply === 'number') addTag(c.supply + '\\u00d7 owned');
    const price = fmtPrice(c.price); if (price) addTag(price);
    if (meta.childElementCount) skillModalBody.appendChild(meta);
    // buy (hidden on your own skills — you can't buy what you authored)
    if (!owned || c.type) {
      const buy = document.createElement('button'); buy.className = 'dt-buy';
      const buyLabel = price && price !== 'Free' ? ('Buy · ' + price) : 'Buy';
      buy.textContent = owned ? 'Owned' : buyLabel; buy.disabled = owned;
      buy.addEventListener('click', () => {
        buy.disabled = true; buy.textContent = 'Buying…';
        vscode.postMessage({ type: 'buySkill', skillId: c.id, creatorWallet: c.creator });
      });
      skillModalBody.appendChild(buy); skillModalBuyBtn = buy;
    }
    if (detail && detail.skillText) {
      const sec = document.createElement('div'); sec.className = 'dt-sec'; sec.textContent = (c.type === 'workflow' ? 'Workflow' : 'Skill') + ' text';
      const bd = document.createElement('div'); bd.className = 'dt-body'; bd.textContent = detail.skillText;
      skillModalBody.appendChild(sec); skillModalBody.appendChild(bd);
    }
  }
  document.getElementById('skillModalClose').addEventListener('click', closeSkillModal);
  skillModalEl.addEventListener('click', (e) => { if (e.target === skillModalEl) closeSkillModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (skillModalOpen || skillDocOpen)) closeSkillModal(); });

  // ---- equipped-skill doc popup: click an installed skill -> show its local SKILL.md ----
  // Equipped skills carry only a name (no mint), so this reads the on-disk SKILL.md by name
  // (host getSkillDoc) and renders the body as markdown, reusing the #skillModal overlay.
  function splitSkillDoc(text) {
    text = text || '';
    // strip a leading YAML frontmatter block so the name/description metadata doesn't
    // dominate the popup; the real instructions live in the markdown body below it.
    const m = text.match(/^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/);
    return (m ? text.slice(m[0].length) : text).trim();
  }
  function openSkillDoc(name) {
    skillModalOpen = false; skillDocOpen = true;
    skillModalName = null; skillModalBuyBtn = null;
    skillModalBody.innerHTML = '<div class="skDoc-empty">Loading…</div>';
    skillModalEl.style.display = 'flex';
    vscode.postMessage({ type: 'getSkillDoc', name: name });
  }
  function renderSkillDoc(name, text) {
    skillModalBody.innerHTML = '';
    const nm = document.createElement('div'); nm.className = 'skDoc-name'; nm.textContent = name;
    skillModalBody.appendChild(nm);
    const body = splitSkillDoc(text);
    if (!body) {
      const e = document.createElement('div'); e.className = 'skDoc-empty';
      e.textContent = 'No SKILL.md document found for this skill.';
      skillModalBody.appendChild(e); return;
    }
    const bd = document.createElement('div'); bd.className = 'skDoc-body';
    renderMd(bd, body);
    skillModalBody.appendChild(bd);
  }
  // Render the detail sub-view from a {card, skillText, requiredCards} payload. For a
  // workflow, each requiredCard is a clickable row that opens ITS detail (re-uses the
  // same view, so you can drill skill→workflow→skill without leaving the market).
  function renderComments(skillId, skillType, notes, owned) {
    const existing = mktDetailBody.querySelector('.dt-comments');
    if (existing) existing.remove();
    const wrap = document.createElement('div'); wrap.className = 'dt-comments';
    const sec = document.createElement('div'); sec.className = 'dt-sec';
    sec.textContent = 'Comments (' + (notes ? notes.length : 0) + ')';
    wrap.appendChild(sec);
    for (const n of (notes || [])) {
      const el = document.createElement('div'); el.className = 'dt-comment';
      const auth = document.createElement('div'); auth.className = 'cm-author';
      if (n.author) {
        // avatar + truncated wallet, the whole row clickable -> that agent's profile
        const av = document.createElement('span'); av.className = 'cm-avatar'; av.innerHTML = avatarSvg(n.author);
        const addr = document.createElement('span'); addr.className = 'cm-addr';
        addr.textContent = n.author.slice(0, 6) + '…' + n.author.slice(-4);
        auth.appendChild(av); auth.appendChild(addr);
        auth.classList.add('cm-link'); auth.title = 'View ' + n.author + "'s profile";
        auth.addEventListener('click', () => showProfile(n.author));
      } else {
        auth.textContent = '?';
      }
      const body = document.createElement('div');
      renderMd(body, n.text || '');
      el.appendChild(auth); el.appendChild(body);
      if (n.gitLink) {
        const gl = gitLinkNode(n.gitLink, 'cm-git');
        if (gl) el.appendChild(gl);
      }
      wrap.appendChild(el);
    }
    // comment input
    const inputWrap = document.createElement('div'); inputWrap.className = 'dt-note-input';
    if (owned) {
      const fh = document.createElement('div'); fh.className = 'an-formhead'; fh.innerHTML = 'FORM // <b>WRITE A COMMENT</b>';
      inputWrap.appendChild(fh);
      const ta = document.createElement('textarea'); ta.placeholder = 'Write a comment…';
      const errEl = document.createElement('div'); errEl.className = 'dt-note-error'; errEl.style.display = 'none';
      const submit = document.createElement('button'); submit.className = 'dt-note-submit'; submit.textContent = 'Post';
      submit.addEventListener('click', () => {
        const text = ta.value.trim();
        if (!text) return;
        submit.disabled = true; submit.textContent = 'Posting…';
        errEl.style.display = 'none';
        vscode.postMessage({ type: 'postNote', skillId, skillType, text });
        ta.value = '';
        // re-enable on next postNoteResult (handled below)
        submit._pending = true;
      });
      submit._reset = () => { submit.disabled = false; submit.textContent = 'Post'; };
      submit._fail = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; submit.disabled = false; submit.textContent = 'Post'; };
      inputWrap.appendChild(ta); inputWrap.appendChild(errEl); inputWrap.appendChild(submit);
    } else {
      const gate = document.createElement('div'); gate.className = 'dt-note-gate';
      gate.textContent = 'Buy this skill to leave a comment.';
      inputWrap.appendChild(gate);
    }
    wrap.appendChild(inputWrap);
    mktDetailBody.appendChild(wrap);
  }

  // the item the detail view is currently showing, so a buy result that arrives while
  // it's open can flip its button to "Owned" (the buy can happen right here in detail).
  let currentDetailName = null, detailBuyBtn = null;
  function refreshDetailOwned() {
    if (mktDetailEl.style.display === 'none' || !detailBuyBtn || !currentDetailName) return;
    if (ownedSkills.indexOf(currentDetailName) >= 0) { detailBuyBtn.textContent = 'Owned'; detailBuyBtn.disabled = true; }
  }
  function renderDetail(detail) {
    const c = (detail && detail.card) || {};
    // own-by-mint (server's gate) OR own-by-name (catalog skills, where name is real)
    const owned = ownsMint(c.id) || ownedSkills.indexOf(c.name) >= 0;
    currentDetail = { id: c.id, type: c.type };
    mktDetailBody.innerHTML = '';
    // head: icon + name + kind
    const isWf = c.type === 'workflow';
    const head = document.createElement('div'); head.className = 'dt-head';
    const img = document.createElement('div'); img.className = isWf ? 'dt-img workflow' : 'dt-img';
    img.innerHTML = '<span class="wand">' + (isWf ? ${JSON.stringify(LAYERS_SVG)} : ${JSON.stringify(IQ_LOGO_SVG)}) + '</span>';
    const htxt = document.createElement('div');
    const kind = document.createElement('div'); kind.className = isWf ? 'dt-kind workflow' : 'dt-kind'; kind.textContent = (c.type || 'skill');
    const nm = document.createElement('div'); nm.className = 'dt-name'; nm.textContent = c.name || c.id || '';
    htxt.appendChild(kind); htxt.appendChild(nm);
    head.appendChild(img); head.appendChild(htxt);
    mktDetailBody.appendChild(head);
    // description
    if (c.description) { const d = document.createElement('div'); d.className = 'dt-desc'; d.textContent = c.description; mktDetailBody.appendChild(d); }
    // meta: category + hashtags + supply
    const meta = document.createElement('div'); meta.className = 'dt-meta';
    const addTag = (t) => { const s = document.createElement('span'); s.className = 'dt-tag'; s.textContent = t; meta.appendChild(s); };
    if (c.category) addTag(c.category);
    for (const h of (c.hashtags || [])) addTag('#' + h);
    if (typeof c.supply === 'number') addTag(c.supply + '\\u00d7 owned');
    if (typeof c.stars === 'number' && c.stars > 0) addTag('\\u2605 ' + c.stars); // GH #89: summed stars
    const detailPrice = fmtPrice(c.price);
    if (detailPrice) addTag(detailPrice); // "Free" / "0.1 SOL"
    if (meta.childElementCount) mktDetailBody.appendChild(meta);
    // buy / re-equip / remove. A disposed skill (owned on-chain, un-equipped) shows a free
    // Re-equip; an owned skill shows "Owned" + a Remove (dispose); else the priced Buy.
    const buy = document.createElement('button'); buy.className = 'dt-buy';
    if (isDisposed(c.id)) {
      buy.textContent = 'Re-equip';
      buy.title = "You own this — re-equip it (re-buying would mint another copy)";
      buy.addEventListener('click', () => {
        buy.disabled = true; buy.textContent = 'Re-equipping…';
        vscode.postMessage({ type: 'reEquipSkill', skillId: c.id });
      });
      mktDetailBody.appendChild(buy);
    } else {
      const buyLabel = detailPrice && detailPrice !== 'Free' ? ('Buy · ' + detailPrice) : 'Buy';
      buy.textContent = owned ? 'Owned' : buyLabel; buy.disabled = owned;
      buy.addEventListener('click', () => {
        buy.disabled = true; buy.textContent = 'Buying…';
        vscode.postMessage({ type: 'buySkill', skillId: c.id, creatorWallet: c.creator });
      });
      mktDetailBody.appendChild(buy);
      if (owned) {
        // un-pin: greys it out + stops the agent loading it, but keeps it (re-equip anytime).
        // Non-destructive, so no confirm — it's a reversible toggle, not a delete.
        const rm = document.createElement('button'); rm.className = 'dt-remove'; rm.textContent = 'Unequip';
        rm.title = 'Un-pin this skill: grey it out and stop loading it. You keep the NFT; re-equip anytime.';
        rm.addEventListener('click', () => {
          rm.disabled = true; rm.textContent = 'Unequipping…';
          vscode.postMessage({ type: 'disposeSkill', skillId: c.id });
        });
        mktDetailBody.appendChild(rm);
      }
    }
    detailBuyBtn = buy; currentDetailName = c.name || null; // remember so buyResult can update it
    // required skills (workflow only) — clickable rows
    const reqs = (detail && detail.requiredCards) || [];
    if (reqs.length) {
      const sec = document.createElement('div'); sec.className = 'dt-sec'; sec.textContent = 'Required skills'; mktDetailBody.appendChild(sec);
      for (const rc of reqs) {
        const row = document.createElement('div'); row.className = 'dt-req';
        const w = document.createElement('span'); w.className = 'wand'; w.style.width = '14px'; w.style.color = 'var(--an-green)'; w.innerHTML = ${JSON.stringify(WAND_SVG)};
        const rn = document.createElement('span'); rn.className = 'rq-name'; rn.textContent = rc.name || rc.id;
        const ar = document.createElement('span'); ar.className = 'rq-arrow'; ar.textContent = '\\u203a';
        row.appendChild(w); row.appendChild(rn); row.appendChild(ar);
        row.addEventListener('click', () => openDetail(rc.id)); // drill into that skill
        mktDetailBody.appendChild(row);
      }
    }
    // repos that use this skill, star-ranked (GH #89). Summed stars = c.stars (same source).
    const repos = (detail && detail.repos) || [];
    if (repos.length) {
      const total = typeof c.stars === 'number' ? c.stars : repos.reduce((s, r) => s + (r.stars || 0), 0);
      const sec = document.createElement('div'); sec.className = 'dt-usedby';
      const lbl = document.createElement('span'); lbl.textContent = 'Used by';
      const stt = document.createElement('span'); stt.className = 'uc-star'; stt.textContent = '\\u2605 ' + total;
      sec.appendChild(lbl); sec.appendChild(stt);
      mktDetailBody.appendChild(sec);
      for (const r of repos) {
        const a = document.createElement('a'); a.className = 'dt-repo'; a.href = r.url || '#'; a.target = '_blank'; a.rel = 'noreferrer';
        const nm = document.createElement('span'); nm.className = 'rq-name'; nm.textContent = (r.owner || '') + '/' + (r.name || '');
        const st = document.createElement('span'); st.className = 'dt-repo-stars'; st.textContent = '\\u2605 ' + (r.stars || 0);
        a.appendChild(nm); a.appendChild(st);
        mktDetailBody.appendChild(a);
      }
    }
    // body (skillText)
    if (detail && detail.skillText) {
      const sec = document.createElement('div'); sec.className = 'dt-sec'; sec.textContent = (c.type === 'workflow' ? 'Workflow' : 'Skill') + ' text'; mktDetailBody.appendChild(sec);
      const body = document.createElement('div'); body.className = 'dt-body'; body.textContent = detail.skillText; mktDetailBody.appendChild(body);
    }
    // comments section (issue #34) — notes bundled in detail, or empty on first render
    renderComments(c.id, c.type, detail && detail.notes, owned);
  }
  function renderMarketResults(results) {
    results = results || [];
    mktResults.innerHTML = '';
    if (!results.length) {
      // empty can mean "no match" OR "no DAS RPC so reads return nothing" — say which.
      mktResults.innerHTML = dasReady
        ? '<div class="mktEmpty">No skills found.</div>'
        : '<div class="mktEmpty">No skills found. The default RPC can\\'t read the marketplace. Add a Helius key (free devnet tier) in the wallet menu \\u2192 RPC.</div>';
      return;
    }
    let shown = 0, hidden = 0;
    for (const r of results) {
      // The whole SD card opens the detail view (where Buy lives) — an already-owned card
      // reads muted (dim). Workflows get the mint cartridge via is-workflow inside skillSdCard.
      const owned = ownedSkills.indexOf(r.name) >= 0;
      // "Hide owned" (on by default): you came to find NEW skills, so drop the ones you hold.
      if (hideOwnedMarket && owned) { hidden++; continue; }
      mktResults.appendChild(skillSdCard(r, { owned: owned, dim: owned, onOpen: (c) => openDetail(c.id) }));
      shown++;
    }
    // everything matched but all of it is already owned and filtered out — say why the grid is empty.
    if (!shown && hidden) {
      mktResults.innerHTML = '<div class="mktEmpty">You already own all ' + hidden + ' matching skill' + (hidden > 1 ? 's' : '') + '. Uncheck "Hide owned" to see them.</div>';
    }
  }

  // resolve a skill display name from a buy result's id, using the last search results.
  function nameForId(id) {
    for (const r of lastMarketResults) if (r.id === id) return r.name || r.id;
    return null;
  }
  // Ownership for the comment gate is decided by MINT, not by display name — the
  // server gates postNote on getBalance(mint), so the UI must use the same key.
  // skillMints maps owned slug -> mint; a detail whose id is one of those values is
  // held. (Name matching breaks for held skills the catalog omits, whose detail comes
  // back with name === mint.)
  function ownsMint(id) {
    if (!id) return false;
    for (const k in skillMints) if (skillMints[k] === id) return true;
    return false;
  }
  // A skill the wallet owns on-chain but un-pinned (disposed). Still owned (soulbound), so
  // the detail offers a free Re-equip instead of a paid re-Buy.
  function isDisposed(id) { return !!id && disposedMintSet.has(id); }

  // ---- COMPLETE overlay: pop the green LED plaque with a [CONTEXT] sub-label, auto-dismiss.
  // Design "OVERLAY // COMPLETE": one plaque, only the label swaps per action.
  const celebrateEl = document.getElementById('celebrate');
  let celebTimer = null;
  function showComplete(label) {
    celebrateEl.innerHTML =
      '<div class="cmpWrap">'
      + '<div class="cmpPlaque"><div class="cmpLed"><span>COMPLETE</span></div></div>'
      + '<div class="cmpLabel">[' + escapeHtml(label || 'DONE') + ']</div>'
      + '</div>';
    celebrateEl.classList.remove('out');
    celebrateEl.classList.add('show');
    clearTimeout(celebTimer);
    celebTimer = setTimeout(() => {
      celebrateEl.classList.add('out');
      setTimeout(() => { celebrateEl.classList.remove('show', 'out'); celebrateEl.innerHTML = ''; }, 450);
    }, 2200);
  }
  celebrateEl.addEventListener('click', () => { // click to dismiss early
    clearTimeout(celebTimer);
    celebrateEl.classList.remove('show', 'out'); celebrateEl.innerHTML = '';
  });

  // ---- wallet SOL balance: shown in the wallet dropdown + market header ----
  let solLamports = null; // last known balance (lamports); null = unknown/failed
  function fmtSol(lamports) {
    if (lamports == null) return null;
    const sol = lamports / 1e9;
    // compact: up to 4 dp, trim trailing zeros (e.g. 1.5 SOL, 0.0123 SOL, 0 SOL)
    const s = sol < 1 ? sol.toFixed(4) : sol.toFixed(3);
    return s.replace(/\\.?0+$/, '') + ' SOL';
  }
  // An item's price (lamports string from chain) → display: "Free" at 0, else SOL.
  // null/undefined = price unknown (indexer didn't read it) → no label.
  function fmtPrice(price) {
    if (price == null) return null;
    const n = Number(price);
    if (!Number.isFinite(n)) return null;
    return n === 0 ? 'Free' : fmtSol(n);
  }
  function renderBalance() {
    const txt = fmtSol(solLamports);
    const low = solLamports != null && solLamports < 5000; // basically can't even pay a tx fee
    const wb = document.getElementById('wBalance');
    const mb = document.getElementById('mktBalance');
    if (wb) {
      const amt = wb.querySelector('.balAmt');
      if (txt == null) { wb.style.display = 'none'; }
      else { if (amt) amt.textContent = txt; wb.style.display = 'flex'; wb.classList.toggle('low', low); }
    }
    if (mb) {
      if (txt == null) { mb.style.display = 'none'; }
      else { mb.textContent = txt; mb.style.display = 'inline-flex'; mb.classList.toggle('low', low); }
    }
  }

  // ---- buy-failure banner: orange-bordered box with an (i) icon, auto-dismiss ----
  const buyErrEl = document.getElementById('buyErr');
  let buyErrTimer = null;
  function showBuyError(msg, fundable) {
    buyErrEl.innerHTML =
      '<div class="buyErrBox">'
      + '<span class="buyErrIcon">i</span>'
      + '<div class="buyErrText"><span class="t">Purchase failed</span>'
      + '<span class="m">' + escapeHtml(msg || 'Something went wrong. Please try again.') + '</span>'
      + (fundable ? '<button class="buyErrFund">Get devnet SOL</button>' : '')
      + '</div>'
      + '<button class="buyErrClose" title="Dismiss">\\u00d7</button>'
      + '</div>';
    buyErrEl.classList.add('show'); buyErrEl.style.display = 'block';
    buyErrEl.querySelector('.buyErrClose').addEventListener('click', hideBuyError);
    // devnet-only: a broke wallet can request faucet SOL right from the banner (airdrop →
    // airdropResult), then retry the buy. The host owns the faucet call (session.ts).
    const fundBtn = buyErrEl.querySelector('.buyErrFund');
    if (fundBtn) fundBtn.addEventListener('click', () => {
      fundBtn.disabled = true; fundBtn.textContent = 'Requesting devnet SOL…';
      vscode.postMessage({ type: 'airdrop' });
    });
    clearTimeout(buyErrTimer);
    // give time to click the fund button before auto-dismiss
    buyErrTimer = setTimeout(hideBuyError, fundable ? 20000 : 7000);
  }
  function hideBuyError() {
    clearTimeout(buyErrTimer);
    buyErrEl.classList.remove('show');
    setTimeout(() => { if (!buyErrEl.classList.contains('show')) { buyErrEl.style.display = 'none'; buyErrEl.innerHTML = ''; } }, 220);
  }

  // ---- RPC status (issue #23): show whether a DAS-capable RPC (Helius) is set ----
  let dasReady = false;
  let rpcNetwork = 'devnet'; // drives explorer-link cluster (set from rpcStatus)
  const rpcState = document.getElementById('rpcState');
  const rpcHint = document.getElementById('rpcHint');
  const rpcSetBtn = document.getElementById('rpcSetBtn');
  const rpcDefaultBtn = document.getElementById('rpcDefaultBtn');
  // The default RPC is never shown — the user only sees "key set" (green masked box +
  // net badge) or "no key" (a warn link to set one). devnet/mainnet is a badge driven
  // by the central network. (issue #23)
  function netBadge(network) {
    const n = network === 'mainnet' ? 'mainnet' : 'devnet';
    return '<span class="netBadge ' + n + '">' + n + '</span>';
  }
  function renderRpcStatus(s) {
    s = s || { dasReady: false, hasKey: false, masked: null, network: 'devnet' };
    dasReady = !!s.dasReady;
    rpcNetwork = s.network || 'devnet';
    if (s.hasKey && s.masked) {
      // green box: masked key (last chars only) + the network badge
      rpcState.innerHTML = '<span class="rpcKeyBox">\\u2713 ' + escapeHtml(s.masked) + '</span> ' + netBadge(s.network);
      rpcSetBtn.textContent = 'Change'; rpcSetBtn.style.display = '';
      rpcDefaultBtn.textContent = 'Remove'; rpcDefaultBtn.style.display = '';
      rpcHint.style.display = 'none';
    } else {
      // no key: just a warning that doubles as the set action + the network badge
      rpcState.innerHTML = '<span class="rpcWarn" id="rpcWarnSet">\\u26a0 Set Helius key</span> ' + netBadge(s.network);
      const w = document.getElementById('rpcWarnSet');
      if (w) w.addEventListener('click', () => vscode.postMessage({ type: 'setHeliusKey' }));
      rpcSetBtn.style.display = 'none';
      rpcDefaultBtn.style.display = 'none';
      rpcHint.style.display = 'none';
    }
  }
  rpcSetBtn.addEventListener('click', () => vscode.postMessage({ type: 'setHeliusKey' }));
  rpcDefaultBtn.addEventListener('click', () => vscode.postMessage({ type: 'useDefaultRpc' }));
  vscode.postMessage({ type: 'getRpcStatus' }); // hydrate on load

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
    lightSkillSlot(name, dwell); // glow the matching equipped slot + header while it fires
  }
  // Glow only while a skill is actually firing: the matching slot (.firing) plus the
  // header/button accent, then clear after the same dwell as the marquee.
  let firingTimer = null;
  function lightSkillSlot(name, dwell) {
    const grid = document.getElementById('skillGrid');
    const panel = document.getElementById('skillsPanel');
    const btn = document.getElementById('skillsBtn');
    const clear = () => {
      grid.querySelectorAll('.an-sd.is-firing').forEach((s) => s.classList.remove('is-firing'));
      panel.classList.remove('casting'); btn.classList.remove('casting');
    };
    clear();
    grid.querySelectorAll('.an-sd').forEach((s) => { if (s.getAttribute('data-skill') === name) s.classList.add('is-firing'); });
    panel.classList.add('casting'); btn.classList.add('casting'); // header/button cue even if the name has no slot
    clearTimeout(firingTimer);
    firingTimer = setTimeout(clear, Math.max(dwell || 0, 1400));
  }
  function hideActivity() { clearTimeout(actTimer); activityBar.classList.remove('out'); activityBar.style.display = 'none'; }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Fill the wallet pill, the wallet dropdown, and the full wallet page from one address.
  function short(a) { return a && a.length > 10 ? a.slice(0, 4) + '..' + a.slice(-3) : a; }
  let myWalletAddress = null; // tracked so openWalletPage can showProfile(own)
  function setWallet(address) {
    myWalletAddress = address || null;
    const full = address || '(not connected)';
    document.getElementById('wAddr').textContent = address ? short(address) : 'not connected';
    const label = address ? short(address) : 'My Wallet';
    document.getElementById('wName').textContent = label;
    document.getElementById('wName2').textContent = address ? 'My Wallet' : 'My Wallet';
    // wallet-seeded character avatar (ported from solchat); same address = same face
    const svg = address ? avatarSvg(address) : '';
    document.getElementById('wAvatar').innerHTML = svg;
    document.getElementById('wAvatar2').innerHTML = svg;
    // #wAvatarBig + #walletAddr are SHARED with the agent-profile view. A wallet/sync
    // push must not clobber them with our own identity while we're browsing someone
    // else's profile — only paint them when the open profile is our own (or none yet).
    if (currentProfileWallet === null || currentProfileWallet === address) {
      document.getElementById('walletAddr').textContent = full;
      document.getElementById('wAvatarBig').innerHTML = svg;
    }
  }

  // Drive sync indicator next to the pill: ✓ synced / ⚠ failed (hover = why).
  function renderCloudSync(status) {
    const el = document.getElementById('cloudSync');
    if (!el) return;
    el.onclick = null; el.style.cursor = '';
    if (!status || !cloudConnected) { el.textContent = ''; el.className = ''; el.title = ''; return; }
    if (status.ok) { el.textContent = '✓'; el.className = 'ok'; el.title = 'Synced to Drive'; }
    else if (status.reason === 'reauth') {
      // Dead cloud sign-in (token expired/revoked). Google requires interactive consent,
      // so we can't fix it silently — surface a one-tap reconnect right on the indicator.
      el.textContent = '⚠ reconnect';
      el.className = 'err';
      el.title = 'Cloud sign-in expired. Click to reconnect ' + (cloudKind === 'gdrive' ? 'Google Drive' : 'cloud') + '.';
      el.style.cursor = 'pointer';
      el.onclick = () => vscode.postMessage({ type: 'reconnectCloud', kind: cloudKind || 'gdrive' });
    }
    else { el.textContent = '⚠'; el.className = 'err'; el.title = 'Drive sync failed (auto-retrying): ' + (status.error || 'unknown'); }
  }

  // My Wallet: storage summary mirrors the pill; address comes from the extension.
  function renderWalletStorage() {
    // Storage line was removed from the profile page (kept only in the wallet dropdown).
    const el = document.getElementById('walletStorage');
    if (!el) return;
    el.textContent = cloudConnected ? 'Local + cloud mirror (connected)' : 'Local only (no cloud)';
  }
  document.getElementById('disconnectWalletBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'disconnectWallet' });
  });
  // Dropdown twin of the profile's Disconnect: the surface closes every panel on
  // disconnect, so no local menu-close bookkeeping is needed here.
  document.getElementById('walletDisconnect').addEventListener('click', () => {
    vscode.postMessage({ type: 'disconnectWallet' });
  });

  // ---- scroll-to-top → load older page ----
  let pageCursor = null;   // cursor for the NEXT older page (null = none / at start)
  let hasMore = false;     // older pages exist?
  let loadingOlder = false;
  let lastOlderCursor = null; // last cursor we asked for; never auto-request the same one twice
  function resetPaging() { pageCursor = null; hasMore = false; loadingOlder = false; lastOlderCursor = null; }

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
    const openTurn = (userText, badge, imageCount) => {
      const turn = document.createElement('div'); turn.className = 'turn';
      const head = document.createElement('div'); head.className = 'turnHead';
      head.innerHTML = '<span class="uq">&gt;</span>';
      head.appendChild(makeUtext(userText));
      if (badge) { const b = document.createElement('span'); b.className = 'badge ' + badge;
        b.textContent = badge === 'codex' ? 'codex · gpt' : 'claude'; head.appendChild(b); }
      const imgEl = userImagesEl(imageCount ? { count: imageCount } : undefined);
      if (imgEl) head.appendChild(imgEl);
      const b = document.createElement('div'); b.className = 'turnBody';
      turn.appendChild(head); turn.appendChild(b); frag.appendChild(turn); return b;
    };
    const node = (cls) => { const n = document.createElement('div'); n.className = 'node ' + cls;
      (body || (body = openTurn('', undefined))).appendChild(n); return n; };
    for (const m of messages) {
      if (m.role === 'user') { body = openTurn(m.text, undefined, m.imageCount); continue; }
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
      if (m.role === 'assistant') addFooter(n, m.durationMs, m.model);
    }
    // Insert above the current content, then restore the viewport SYNCHRONOUSLY (before the
    // browser paints) so the user's position never visibly jumps. Disable smooth-scroll for
    // the correction — otherwise the scrollTop bump animates and reads as a jump. Late-loading
    // images that grow the prepended block are handled natively by overflow-anchor on #log.
    const prevBehavior = realLog.style.scrollBehavior;
    realLog.style.scrollBehavior = 'auto';
    realLog.insertBefore(frag, realLog.firstChild);
    void realLog.offsetHeight; // force layout so scrollHeight is accurate
    realLog.scrollTop += realLog.scrollHeight - before;
    realLog.style.scrollBehavior = prevBehavior;
  }

  function requestOlder() {
    // pageCursor !== lastOlderCursor: a well-behaved host always answers with a SMALLER
    // cursor, so this is normally true. If a host ever returns hasMore:true without
    // advancing the cursor (e.g. an empty page bug), this stops the loadMore ping-pong
    // instead of spinning forever through maybeFillOlder's re-check.
    if (hasMore && !loadingOlder && pageCursor !== null && pageCursor !== lastOlderCursor) {
      loadingOlder = true;
      lastOlderCursor = pageCursor;
      vscode.postMessage({ type: 'loadMore', cursor: pageCursor });
    }
  }

  // When the loaded content doesn't overflow the viewport there is no scrollbar, so the
  // 'scroll' listener can never fire to fetch older pages — older history would be
  // unreachable. Proactively pull the next older chunk whenever there's nothing to scroll;
  // this chains (each 'older' re-checks) until the log overflows or no pages remain.
  function maybeFillOlder() {
    if (log.scrollHeight <= log.clientHeight) requestOlder();
  }

  log.addEventListener('scroll', () => {
    // preemptive load: fetch the next older page BEFORE the user hits the very top, so there
    // is always more scroll above and they never slam into the edge (which read as a jump).
    if (log.scrollTop < 600) requestOlder();
    // track pin state: stay pinned (auto-scroll) only while near the bottom, else show the
    // jump button. User scrolling is direct (not smooth), so this reads the true position.
    stick = nearBottom(); updateJump();
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.type === 'message') onMessage(m.msg);
    else if (m.type === 'sessions') { allSessions = m.list || []; cloudListState = m.cloud || 'none'; activeId = m.activeId; renderSessions(); }
    else if (m.type === 'notice') renderNotice(m.text || '');
    else if (m.type === 'status') renderStatus(m.status || {});
    else if (m.type === 'loading') showLoading();
    else if (m.type === 'clear') { log.innerHTML = ''; approvalDock.innerHTML = ''; ctxMeter.style.display = 'none'; syncComposerLock(); streaming = null; openBash = null; tailTurn = null; headTurn = null; hideTyping(); hideActivity(); resetPaging(); syncWatermark(); hideLoading(); }
    else if (m.type === 'turnEnd') { hideTyping(); hideActivity(); }
    else if (m.type === 'modelOptions') { applyModelOptions(m.cli, m.options); }
    else if (m.type === 'usage') {
      // update the context token meter near the composer chips
      const n = m.contextTokens;
      if (typeof n === 'number') {
        const label = n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
        ctxMeter.textContent = 'ctx: ' + label;
        ctxMeter.style.display = 'inline-flex';
      }
    }
    else if (m.type === 'skillActive') flashSkill(m.name); // a real skill fired (was /mockskill)
    else if (m.type === 'rpcStatus') renderRpcStatus(m.status);
    else if (m.type === 'skillShopping') setShopToggle(m.on);
    else if (m.type === 'searchResults') {
      lastMarketResults = m.results || [];
      renderSkillResults(m.results);           // the small skills-panel shop
      renderMarketResults(m.results);          // the full Markets view
    }
    else if (m.type === 'searchError') {
      // don't hang on "Searching…" — show the real reason in both views
      const msg = 'Search failed: ' + escapeHtml(m.message || 'unknown');
      mktResults.innerHTML = '<div class="mktEmpty">' + msg + '</div>';
      skillResults.innerHTML = '<div class="shopEmpty">' + msg + '</div>';
      // the profile view shares no element with these — clear its loading state too so
      // a failed getAgentProfile doesn't leave the profile stuck on "Loading…".
      if (currentProfileWallet) {
        document.getElementById('agentIdCard').innerHTML = '<div class="pr-empty">Could not load profile.</div>';
        document.getElementById('profileBody').innerHTML = '<div class="pr-empty">' + msg + '</div>';
      }
    }
    else if (m.type === 'skillDetail') { if (skillModalOpen) renderSkillModal(m.detail); else renderDetail(m.detail); }
    else if (m.type === 'skillDoc') { if (skillDocOpen) renderSkillDoc(m.name, m.text); }
    // issue #34: comment write result — re-enable the submit button; on failure show error
    else if (m.type === 'postNoteResult') {
      const submit = mktDetailBody.querySelector('.dt-note-submit');
      if (submit) { m.ok ? submit._reset && submit._reset() : submit._fail && submit._fail(m.error || 'Post failed'); }
    }
    // issue #34: refreshed comments pushed after a successful postNote
    else if (m.type === 'notes' && currentDetail && m.skillId === currentDetail.id) {
      // currentDetail.id is a MINT — gate by mint (the old name-array lookup against a
      // mint always missed, so the comment box vanished on every refresh after a buy).
      const owned = ownsMint(currentDetail.id) || ownedSkills.indexOf(currentDetailName) >= 0;
      renderComments(currentDetail.id, currentDetail.type, m.notes, owned);
    }
    else if (m.type === 'ownedSkills') {
      disposedMints = m.disposedMints || {};         // slug->mint, greyed in the panel
      disposedMintSet = new Set(Object.values(disposedMints)); // mints, for isDisposed()
      workflowMintSet = new Set(m.workflowMints || []); // owned workflows, kept out of the picker
      setSkills(m.names || [], m.mints || {});  // updates ownedSkills used by both renders
      // flip Buy → Owned everywhere the item can appear: list cards, small panel, open detail
      if (panels.market.style.display !== 'none') renderMarketResults(lastMarketResults);
      renderSkillResults(lastMarketResults);   // small skills-panel shop badges
      refreshDetailOwned();                    // detail view (if open) — clears its "Buying…"
      refreshModalOwned();                     // skill popup (if open) — flip Buy → Owned
    }
    else if (m.type === 'buyResult') {
      if (m.ok) {
        // COMPLETE plaque; label reflects whether the open detail is a workflow or a skill.
        // (the ownedSkills message that follows flips every Buy button to "Owned".)
        showComplete(currentDetail && currentDetail.type === 'workflow' ? 'WORKFLOW PURCHASED' : 'SKILL PURCHASED');
        vscode.postMessage({ type: 'getBalance' }); // funds dropped after a buy — refresh
      } else {
        // a failed buy must NOT wipe the catalog: show the reason in a dismissible
        // orange (i) banner and just re-enable the buttons that were mid-"Buying…".
        // On devnet, an insufficient_funds failure offers a "Get devnet SOL" faucet button.
        showBuyError(m.error, m.code === 'insufficient_funds' && rpcNetwork !== 'mainnet');
        if (detailBuyBtn) { detailBuyBtn.disabled = false; detailBuyBtn.textContent = 'Buy'; }
        if (skillModalBuyBtn) { skillModalBuyBtn.disabled = false; skillModalBuyBtn.textContent = 'Buy'; }
        renderMarketResults(lastMarketResults); // restore any card stuck on "Buying…"
        renderSkillResults(lastMarketResults);
      }
    }
    // devnet faucet result for the "Get devnet SOL" banner button (PR #92 fund flow)
    else if (m.type === 'airdropResult') {
      if (m.ok) {
        renderNotice('Funded. Try the purchase again.');
        vscode.postMessage({ type: 'getBalance' }); // reflect the new balance in the header
        hideBuyError();
      } else {
        renderNotice('Get SOL failed: ' + (m.error || 'unknown'));
        const fb = buyErrEl.querySelector('.buyErrFund');
        if (fb) { fb.disabled = false; fb.textContent = 'Get devnet SOL'; }
      }
    }
    // GitHub verified-work registration (issue #93): token status flips the modal form;
    // a register result closes on success (+ refresh) or shows the error inline.
    else if (m.type === 'githubStatus') { renderRepoModalBody(m); }
    else if (m.type === 'workRepoRegistered') {
      if (m.ok) {
        showComplete('GITHUB REGISTERED');
        closeRepoRegister();
        if (currentProfileWallet) vscode.postMessage({ type: 'getAgentProfile', wallet: currentProfileWallet });
      } else if (repoModalEl) {
        const b = repoModalEl.querySelector('.rr-body');
        const err = b && b.querySelector('.rr-err');
        const btn = b && b.querySelector('.rr-btn');
        if (err) { err.textContent = m.error || 'Registration failed.'; err.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Register repo'; }
      }
    }
    // dispose / re-equip results: the ownedSkills message that follows updates disposedMints
    // + the panel; re-open the detail (if open) so its button flips Remove<->Re-equip.
    else if (m.type === 'disposeResult') {
      if (m.ok) { if (currentDetail) openDetail(currentDetail.id); }
      else {
        showBuyError(m.error || 'Unequip failed');
        const rm = mktDetailBody.querySelector('.dt-remove');
        if (rm) { rm.disabled = false; rm.textContent = 'Unequip'; }
      }
    }
    else if (m.type === 'reEquipResult') {
      if (m.ok) { if (currentDetail) openDetail(currentDetail.id); }
      else {
        showBuyError(m.error || 'Re-equip failed');
        if (detailBuyBtn) { detailBuyBtn.disabled = false; detailBuyBtn.textContent = 'Re-equip'; }
      }
    }
    // issue #35: agent directory + profile
    else if (m.type === 'agents') renderAgents(m.agents);
    else if (m.type === 'agentProfile') renderProfile(m.profile);
    else if (m.type === 'buyAllResult') {
      const confirm = document.getElementById('profileBody') && document.getElementById('profileBody').querySelector('.pr-confirm');
      if (confirm) confirm.remove();
      if (m.ok && currentProfileWallet) {
        // refresh profile + owned list so badges update
        vscode.postMessage({ type: 'getAgentProfile', wallet: currentProfileWallet });
        vscode.postMessage({ type: 'ownedSkills' });
      }
    }
    else if (m.type === 'agentNoteResult') {
      const body = document.getElementById('profileBody');
      const label = (body && body._postLabel) || 'Post';
      if (!m.ok) {
        pendingPost = null;
        postFeedback = { wallet: m.agentWallet, text: m.error || 'Post failed', ok: false, ts: Date.now() };
        if (body && body._postBtn) {
          body._postBtn.disabled = false; body._postBtn.textContent = label;
          if (body._postErr) { body._postErr.textContent = m.error || 'Post failed'; body._postErr.style.display = ''; body._postErr.classList.remove('ok'); }
        }
      } else {
        // Success: stash an optimistic note so it shows immediately (the host re-pushes a
        // profile whose on-chain note read lags and won't include it yet), clear the box,
        // and confirm. renderProfile (triggered by the re-push) merges the optimistic note.
        if (pendingPost) {
          recentlyPosted.push({
            wallet: pendingPost.wallet,
            ts: Date.now(),
            // author must be OUR wallet (the writer), not the profile owner's
            // (pendingPost.wallet): mergeOptimistic dedupes the ghost against the real
            // on-chain note by author+text, and the real note's author is the writer —
            // a profile-owner author only matches on self-posts, so comments on OTHER
            // agents rendered twice once the chain read caught up.
            note: { author: myWalletAddress || pendingPost.wallet, text: pendingPost.text, gitLink: pendingPost.gitLink, isSelfNote: pendingPost.self, parentId: pendingPost.parentId, timestamp: Date.now() },
          });
          pendingPost = null;
        }
        postFeedback = {
          wallet: m.agentWallet,
          text: label === 'Post' ? 'Posted to blog.' : 'Comment posted.',
          ok: true,
          ts: Date.now(),
        };
        showComplete(label === 'Post' ? 'POST PUBLISHED' : 'COMMENT POSTED'); // stays on the profile
        if (body && body._postBtn) {
          body._postBtn.disabled = false; body._postBtn.textContent = label;
          if (body._postTa) body._postTa.value = '';
          if (body._postGit) body._postGit.value = '';
          if (body._postImg) body._postImg.value = '';
          if (body._postTitle) body._postTitle.value = '';
          if (body._postErr) { body._postErr.textContent = label === 'Post' ? 'Posted to blog.' : 'Comment posted.'; body._postErr.style.display = ''; body._postErr.classList.add('ok'); }
        }
      }
    }
    else if (m.type === 'balance') { solLamports = m.lamports; renderBalance(); }
    // make-skill: live mint gauge — each wallet signature ticks the submit button label.
    // A local keypair wallet signs silently (no prompts), so this text is the only
    // feedback during the multi-transaction mint; web wallets see it between prompts.
    else if (m.type === 'publishProgress') {
      const phaseLabel = m.phase === 'store' ? 'Storing on-chain' : m.phase === 'mint' ? 'Minting the NFT' : 'Listing for sale';
      pubSubmit.textContent = 'Publishing… ' + (m.total ? m.signed + '/' + m.total + ' signed · ' : '') + phaseLabel;
    }
    // make-skill: publish finished — reset the button, then on success celebrate + go to market
    else if (m.type === 'publishResult') {
      pubSubmit.disabled = false; pubSubmit.textContent = pubKind === 'workflow' ? 'Publish workflow' : 'Publish skill';
      if (m.ok) {
        const nm = document.getElementById('pubName').value.trim();
        ['pubName','pubDesc','pubCategory','pubHashtags','pubImage','pubText'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('pubPrice').value = '0.1';
        pubImageBadge.style.display = 'none';
        for (const k in pubReqSel) delete pubReqSel[k]; // clear the workflow picker
        const wasWorkflow = pubKind === 'workflow';
        setPubKind('skill');
        showComplete(wasWorkflow ? 'WORKFLOW BUILT' : 'SKILL CREATED');
        showView('market'); // see it listed (it's owned by you now)
      } else {
        pubError.textContent = m.error || 'Publish failed.'; pubError.style.display = 'block';
      }
    }
    else if (m.type === 'platform') setTab(m.cli); // extension switched CLI (e.g. on session open)
    else if (m.type === 'cliStatus') {
      cliReport = { claude: m.claude, codex: m.codex };
      const status = cliReport[cli];
      if (status === 'no-login') renderNotice((cli === 'claude' ? 'Claude' : 'Codex') + ' is not signed in. Type /login to connect it.');
      else if (status === 'missing') renderNotice((cli === 'claude' ? 'Claude' : 'Codex') + ' is not installed.');
    }
    else if (m.type === 'claudeLoginUrl') {
      renderNotice('Claude sign-in opened. If the browser did not open, visit:\\n' + m.url + '\\nAfter approving, paste the returned code with /login <code>.');
    }
    else if (m.type === 'claudeLoginStatus') {
      if (m.status === 'done') {
        cliReport = Object.assign({}, cliReport || {}, { claude: 'ok' });
        renderNotice('Claude sign-in complete.');
        if (cli === 'claude') vscode.postMessage({ type: 'platform', cli: 'claude' });
      } else {
        renderNotice('Claude sign-in failed: ' + (m.error || 'Login was not completed.'));
      }
    }
    else if (m.type === 'codexLoginChallenge') {
      renderNotice('Codex sign-in opened. If the browser did not open, visit:\\n' + m.url + '\\nEnter this one-time code on the page: ' + m.code);
    }
    else if (m.type === 'codexLoginStatus') {
      if (m.status === 'done') {
        cliReport = Object.assign({}, cliReport || {}, { codex: 'ok' });
        renderNotice('Codex sign-in complete.');
        if (cli === 'codex') vscode.postMessage({ type: 'platform', cli: 'codex' });
      } else {
        renderNotice('Codex sign-in failed: ' + (m.error || 'Login was not completed.'));
      }
    }
    else if (m.type === 'toast') renderNotice(m.text || '');
    else if (m.type === 'openUrl' && m.url) window.open(m.url, '_blank', 'noopener,noreferrer');
    else if (m.type === 'storage') { renderStorage(m.info, m.options); renderWalletStorage(); }
    else if (m.type === 'cloudSync') renderCloudSync(m.status);
    else if (m.type === 'wallet') setWallet(m.address);
    else if (m.type === 'page') { hideLoading(); hasMore = m.hasMore; pageCursor = m.cursor; maybeFillOlder(); }
    else if (m.type === 'older') {
      prependOlder(m.messages || []);
      hasMore = m.hasMore; pageCursor = m.cursor; loadingOlder = false;
      maybeFillOlder();
    }
    else if (m.type === 'approval') renderApproval(m.req);
    else if (m.type === 'approvalDismiss') dismissApproval(m.id);
  });

  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'wallet' }); // fill the bottom-left wallet card on load
  vscode.postMessage({ type: 'getBalance' }); // and prime the SOL balance display
</script>
</body>
</html>`;
}
