# Mac and physical Seeker QA — 2026-09-17 UTC

Base implementation: `1eadb451`; this follow-up changes only chat repaint reconciliation and tests.
QA Android package: `com.iqlabs.agentnet.qa245`, isolated from the installed production app.
Localhost bundle SHA-256: `68465bc83b86b7ec5a0402c5d79e0cd2763cae3a797c4a6b4661b2c19a2c4896`.

## Verified normal app behavior

- Mac and physical Seeker used the same approved wallet and Google Drive account.
- Native Android Google authorization succeeded over Wi-Fi after fixing the phone's DNS. No application change was required for that network failure.
- A real Mac Claude turn returned `MAC-245-READY`.
- A real Seeker Codex turn returned `SEEKER-245-READY` after switching away from a quota-limited account.
- The Mac opened the phone-created conversation from Drive and continued it with `MAC-245-CONTINUED`.
- The still-open phone copy continued with `SEEKER-245-CONCURRENT`, without first loading the Mac's turn.
- A fresh Mac view contained all six user/assistant messages in one canonical session, `01a0ad7b-37ee-7b22-8aef-91e3c0b4ee9f`.
- Before this fix, restarting the phone and opening the conversation displayed only its four local messages, despite successful cloud sync. The newest timestamp matched, so reconciliation skipped the earlier Mac exchange.
- After this fix, the restarted phone displayed all six messages, including the Mac exchange. See [physical Seeker screenshot](seeker-merged-history.png).

## Regression and build checks

- The two new same-timestamp regression cases fail against the previous implementation and pass with the fix. One fills the complete 30-message page; both include Korean text. A third case preserves newer local content against an older cloud result.
- Core suite: 506 passed, 5 skipped, 69 files.
- Localhost and webview builds passed. Isolated Android debug APK assembled successfully.
- Existing live Drive harness separately covers pagination, rollover, offline tails/reconnect, immutable sealed pages and legacy preservation; see `drive-harness-live.json`.

## Boundaries

No blockchain posts or transactions were submitted. These were dedicated QA chat conversations. The physical test covers real two-device writes and restart; offline-tail and long-history checks remain the separate live-Drive harness, not claimed as physical-phone tests. Reused Android rootfs/native assets are development fixtures; this is not a production APK release certification. The unrelated browser OAuth popup correction remains in its separate worktree.

## Review follow-up: identical newest window, merged cursor

After Zo's review, the branch was rebased onto `1690b0ee` (merged #238 and #244).
The added regression uses real encrypted SessionStore device chains over in-memory
local/cloud adapters: B writes three older Korean messages, A writes 30 newer
messages, and A reopens. The newest messages are identical locally and remotely,
but only the merged cursor exposes B's older history. The test failed before the
fix and now proves the chat dispatcher adopts that cursor and loads all three
older messages without repainting the unchanged newest window.

Post-rebase checks: 547 core tests passed, 5 skipped; TypeScript passed; all six
required Chromium panel tests passed; localhost and webview builds passed. This
follow-up was not rerun on the sleeping physical phone; the device evidence above
records the earlier six-message reconciliation test.
