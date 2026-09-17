# Device-scoped session pages — draft replacement for #245

The original branch-per-resume implementation is removed. Cloud resumes keep the canonical session ID and do not copy history. Each SessionStore has a new writer incarnation, combined with the persisted device ID, so different devices **and concurrent processes on the same device** never intentionally write the same page. Calls within a writer are serialized.

New keys are `{sessionId}__d{deviceId}-{writerId}__dp{N}`. The `__dp` suffix is intentional: old clients parse `__p` and would otherwise treat a device chain as an independent writable session. Legacy `{sessionId}__p{N}` pages remain readable; new clients merge them with device chains. Old clients ignore the new namespace and therefore cannot see its new messages. Two old clients can still overwrite their shared legacy chain. This is not full mixed-version sync.

Device pages contain the existing encrypted records. Message clocks increase monotonically and are seeded from observed history; read ordering uses timestamp and writer identity, preserving order within each chain. Concurrent replies are retained, not resolved into a single authoritative answer. Metadata is selected from the latest chain-head metadata with a deterministic writer tie-breaker. The session list has one canonical entry.

Merged pagination uses an opaque string cursor containing each chain's next unread position. New appends and newly discovered writers do not shift an already-started older-history traversal; a fresh load includes them. Reads start at each chain's tail and fetch earlier pages as needed, rather than copying full history on resume. Local-only first paint remains separate from cloud discovery. Existing numeric cursors and local-only legacy writes remain supported.

Explicit fork/export uses merged history; fork preserves message timestamps. Delete removes the currently listed chains. Full pages remain unchanged on rollover. Reconnect compares local device-page tails with cloud copies: only a strict byte-prefix extension replaces an existing cloud page; a shorter restored backup never replaces a longer cloud copy, and divergent copies produce a status error. Normal debounced uploads to the same key are serialized. Put-only local adapters append by combining bytes rather than replacing the prior log.

## Validation

`packages/core/src/runtime/cloud-resume.spec.ts` retains the original runtime/encrypted-store/mirror harness, now asserting one stable session ID with both writers' messages. It covers simultaneous resumes, Korean text, rollover, legacy source bytes, fresh cloud reads, local-only behavior, missing-page fork rejection, ephemeral sessions, and offline backfill.

`packages/core/src/account/devicePages.spec.ts` adds same-device parallel writers and appends; stable pagination while new data arrives; clock skew and legacy reads; remote tail and metadata refresh; offline extension of an existing cloud page; fork/delete; missing-page failure; stale-backup protection; fork timestamps; old-client namespace isolation; serialized uploads; and sealed-page immutability.

Final local result: **503 tests passed, 5 platform skips across 69 files**, with Chromium panel checks required. Core, panel, CLI and localhost typechecks passed; CLI, MCP, webview and VS Code builds passed. Raw test/build receipts are adjacent. Formatting afterward changed whitespace only in the new helper and its spec. No model/provider calls, user Drive documents, or on-chain writes are made by these fixtures. The mocked pieces are engine/native history injection and cloud transport; runtime start/resume, encryption, storage, pagination, and mirror logic run as actual code.

## Review and integration status

The implementation and local regression suite are complete for this draft. The key suffix and per-process writer incarnation are the two deliberate details added to the proposed sketch: they prevent old-reader namespace collisions and concurrent processes sharing a device key.

A real two-device Google Drive run has **not** been performed: this checkout has no saved Google sign-in. The local harness exercises the actual encrypted storage/runtime paths with an in-memory cloud adapter, so it does not establish Drive transport acceptance. The PR remains draft until that integration check is complete.

Known scope limits: old clients do not display new-format messages; two old clients still share legacy keys. Each process restart adds a chain head, increasing discovery reads. Delete does not add distributed tombstones, and a restored stale local backup is not automatically refreshed from its longer cloud copy. Serializing uploads does not provide server-side fencing for requests that complete after a timeout. This change does not recover history already overwritten before it was installed.
