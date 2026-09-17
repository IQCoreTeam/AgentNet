# Google login navigation — 2026-09-17

Base: `bfbe88ec` (includes merged #245).

## Browser reproduction

A temporary Vite page invoked the exact pre-fix helper and the patched imported
`openExternalUrl` from separate buttons, targeting a local HTML page. Chrome was
controlled through the browser tool; no Google credentials or grants were involved.

| Check | Before | After |
| --- | --- | --- |
| Original app page stays open | No; navigated to destination | Yes |
| Destination tabs opened per click | Two, including original tab | One new tab |
| Destination `window.opener` | null | null |
| New destination `document.referrer` | Not recorded before subsequent dev reloads | empty |

The original helper interprets the null return from successful
`window.open(url, '_blank', 'noopener,noreferrer')` as popup blocking and navigates
the original tab too. The fix opens a same-origin blank tab, clears its opener,
then follows a noreferrer link. A genuinely blocked popup retains same-tab fallback.

## Regression coverage

- Real App, Sessions and ConnectDriveForm mounted in the React test, with a mocked
  host store and external opener: current main opens three times across settings
  remounts; the fixed App owner opens once. StrictMode and a second OAuth attempt
  are included. The test fails on main and passes on this change.
- Helper tests cover new-tab navigation, opener isolation/referrer policy, blocked
  popup fallback, and the unchanged native Android bridge.
- Browser checks cover navigation mechanics, not a fresh Google token exchange.
  No OAuth backend, permissions, storage or wallet behavior is changed.

## Checks

- Webview: 11 tests passed; production build passed (existing chunk-size warning).
- Core: 547 passed, 5 skipped with two workers; typecheck passed.
- The first core run, concurrent with webview tests/build, exceeded the existing
  one-second wait in `cloud-resume.spec.ts` (30 messages observed before the new
  append finished). The unchanged suite passed with bounded concurrency. No runtime
  or storage code was modified by this PR.
- Webview tests and build are now included in CI so these regressions are checked
  on clean installs rather than relying only on this local run.
