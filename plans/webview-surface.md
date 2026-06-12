# surfaces/webview — React SPA Plan

The chat UI that the Android WebView loads. This is NOT a hosted web service and we don't
intend to ship a browser product — the build output (dist/) is the screen the Android
shell embeds, talking to the local node over HTTP. A desktop browser is only used as a
dev/debug harness while building it (vite dev → surfaces/localhost). Built referencing the
example apps (OpenGUI = React/Tailwind, codex-mobile = mobile patterns) but NOT copying
them. Per the UI decision in [mobile-strategy.md](./mobile-strategy.md): `packages/core` is
the one shared codebase (dispatcher, transport, runtime, wallet, storage); the UI forks by
surface. vscode keeps its HTML webview; the mobile/WebView surface is this React SPA.

## The key fact: the contract is already frozen

`surfaces/localhost` is done — SSE `/events` + POST `/rpc`, reconnect/replay, the wallet
handshake, and the chat dispatcher attach all work. The chat dispatcher (`createChatSession`)
speaks a fixed message protocol over that transport. **So this SPA is not a new system — it's
a second client for an existing protocol.** The only server change is: serve this SPA's build
output instead of `chatHtml()` / `onboardingHtml()`.

### The protocol the SPA must speak (extracted from core + webview.ts)

**UI → server** (POST `/rpc?client=<id>`, body `{type, ...}`):
`ready`, `new`, `newTab`, `open {sessionId}`, `platform {cli}`, `model {model?}`,
`send {text}`, `loadMore {cursor}`, `delete {sessionId}`, `wallet`, `disconnectWallet`,
`pickCloud`, `connectCloud {kind, location?, authHeader?}`, `disconnectCloud`,
`openCloud {kind, location?}`, `approvalDecision {id, outcome: once|always|deny, reason?}`.
Onboarding-only: `connectWallet {address, signature[]}`.

**server → UI** (SSE event, data `{type, ...}`):
`clear`, `message {msg: ChatMessage}`, `turnEnd`, `page {hasMore, cursor}`,
`older {messages, hasMore, cursor}`, `sessions {list, activeId}`, `loading`,
`platform {cli}`, `storage {info, options}`, `cloudSync {status}`, `wallet {address}`,
`approval {req: ApprovalRequest}`. Onboarding-only: `init {...}`, `walletConnected {...}`,
`toast {text}`.

`ChatMessage`: `{role: user|assistant|thinking|tool|summary, text, cli?, partial?,
durationMs?, model?, tool?: {name?, command?, output?, exitCode?, file?, diff?}}`.
`partial:true` = append delta to the current bubble (streaming); `partial:false` = bubble done.

`ApprovalRequest`: `{id, cli, sessionId, tool, kind: bash|edit|write|read|other, title,
command?, file?, diff?, input?}`. Decision outcome: `once | always | deny`.

## Architecture

```
surfaces/webview/
  index.html                 # Vite entry; mobile viewport + safe-area meta
  vite.config.ts             # base:'./' (WebView origin-relative), build → dist/
  tailwind.config / index.css
  src/
    main.tsx                 # boot React, mount #app
    transport/
      client.ts              # SSE /events + POST /rpc, reconnect w/ cursor replay,
                             #   client-id handshake. ONE injectable seam (testable).
      protocol.ts            # the message type unions above, as TS types
    state/
      store.tsx              # useReducer + context: messages, sessions, approvals,
                             #   wallet, storage, streaming bubble. Mirrors the
                             #   dispatcher's events → UI state.
    onboarding/
      ConnectWallet.tsx      # detect Phantom/Solflare/Backpack, signMessage(
                             #   SESSION_KEY_MESSAGE), POST connectWallet
    chat/
      ChatScreen.tsx         # header + MessageList + Composer + ApprovalDock
      MessageList.tsx        # the turn-threaded log; bottom-anchored scroll
      Message.tsx            # user/assistant/thinking/summary bubbles
      ToolCard.tsx           # bash/edit/read/write cards (command, diff, output)
      Markdown.tsx           # markdown → sanitized HTML (assistant bubbles only)
      Composer.tsx           # textarea + send; engine tabs; model dropdown;
                             #   FREEZE during pending approval (parity w/ vscode fix)
      ApprovalDock.tsx       # pending approval cards above the composer
      Sessions.tsx           # history list / new / delete
```

### Transport client (the one seam that matters)

Mirror what `onboarding.ts` / `webview.ts` already do in the browser branch, but as a real
module instead of an inline shim:
- `GET /events` → on first `event: client` grab the id; tag every POST with `?client=<id>`.
- Buffer the last seen event id; on SSE error EventSource auto-reconnects — reopen
  `/events?client=<id>&cursor=<lastId>` so the server replays what we missed (server already
  supports this).
- `post(msg)` → `fetch('/rpc?client='+id, {method:'POST', body: JSON.stringify(msg)})`.
- Expose `onEvent(cb)` and `post(msg)`. The store subscribes to `onEvent`; UI actions call
  `post`. This is the entire surface area between UI and core.

### State store

A single `useReducer` keyed by event type (OpenGUI's pattern, minus the multi-harness
abstraction we don't need — one agent). Each server→UI event is one reducer action:
- `message` → append/stream into the current bubble (respect `partial`), or push a tool card.
- `clear` → reset log + approvals (and unfreeze composer).
- `sessions` / `storage` / `wallet` / `cloudSync` → slice updates.
- `approval` → push to the approvals slice (composer derives "frozen" from `approvals.length>0`).
- `page` / `older` → set/prepend with scroll-anchor preservation.

### Markdown

Reuse core's already-bundled marked + dompurify rather than adding react-markdown +
starry-night (heavier, and we just fixed core's md path). Two clean options — decide at impl:
(a) import marked/dompurify directly as web deps and render to sanitized HTML in `Markdown.tsx`;
(b) export a tiny `renderMarkdown(text): string` from core and call it. Prefer whichever keeps
one markdown implementation across surfaces. (NOT the inline-into-`<script>` trick — that was
only for the string-template webview.)

### Mobile (carry into android unchanged)

- Visual-viewport keyboard avoidance via CSS vars (`--vvh`, `--vv-offset`) set on
  `visualViewport` resize — codex-mobile's technique. Composer stays above the keyboard.
- `env(safe-area-inset-*)` padding for notch/home-bar.
- Flex column with `min-h-0` on the scroll container (the classic flex-scroll gotcha).
- Touch-sized targets; `base:'./'` so all asset URLs are origin-relative (WebView-safe).

## Server change (surfaces/localhost) — small, do LAST

Today `/` → `chatHtml()`, `/onboarding` → `onboardingHtml()`, no static asset route.
Change to: serve `surfaces/webview/dist/` as static files (`/`, `/assets/*`), SPA-fallback any
unknown GET to `index.html`. `/events` + `/rpc` stay exactly as they are. The wallet-gate
(302 → onboarding when no runtime) becomes the SPA's own routing: the SPA shows ConnectWallet
until `walletConnected`, then the chat — same `connectWallet`/`walletConnected` messages.

## Build order — all DONE (initial pass, 2026-06-11)

1. [x] `surfaces/webview` scaffold: Vite + React + Tailwind, `index.html`, mobile meta, `base:'./'`.
2. [x] `transport/client.ts` + `protocol.ts` — verified against the running localhost server
   (open `/events` → client id, POST `ready` → `init` pushed back over SSE).
3. [x] `state/store.tsx` — events → state (StoreProvider + useReducer; one action per event).
4. [x] Onboarding `ConnectWallet.tsx` — Phantom/Solflare/Backpack detect + signMessage.
5. [x] Chat screen: MessageList + Message + ToolCard + Markdown, streaming via `partial`.
6. [x] Composer + ApprovalDock — including the approval-freeze behavior (parity w/ vscode).
7. [x] Sessions list (new/open/delete/loadMore).
8. [x] Mobile polish: --vvh visual-viewport keyboard avoidance + env(safe-area-inset-*).
9. [x] Wired `surfaces/localhost` to serve `dist/` (catch-all GET → SPA, AGENTNET_WEBVIEW_DIR
   override). E2E confirmed: `/` serves the SPA, assets 200, unknown path → index.html, /events
   + /rpc unchanged.

Markdown note: implemented via core's `MD_LIBS` (subpath import
`@iqlabs-official/agent-sdk/chat/ui/mdLibs.generated`, NOT the barrel — the barrel drags in
node-only modules that can't bundle for the browser). The generated decode was switched to
atob+TextDecoder so it runs in the browser too (Buffer is node-only). Same marked+dompurify
engine as the vscode webview.

### Not yet done (next passes)
- Real Phantom signMessage E2E in a browser against a wallet-connected runtime (needs a wallet).
- Storage pill / wallet page / cloud actions UI (events are wired in the store; no UI yet).
- The Android shell (`surfaces/android`) that embeds this dist/ — separate session.

## Explicitly NOT doing (avoid over-engineering — examples over-build for N backends)

- No multi-harness abstraction. One agent (claude via SDK; codex is a tab, not a 2nd harness).
- No virtualized list yet — plain bottom-anchored scroll; add `@tanstack/react-virtual` only
  if a real session lags.
- No starry-night/WASM highlighter — core's marked covers fenced code.
- No SvelteKit/Next — pure Vite SPA; the server is already `surfaces/localhost`.
