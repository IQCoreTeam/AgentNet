// Re-key migration: copy every session from one wallet's store into another's.
// Reads decrypt under the SOURCE wallet's key (load), writes re-encrypt under the
// DESTINATION's (appendMessage/recordMeta) — the crypto is entirely inherited from
// SessionStore; none happens here. Non-destructive by construction: the source is
// only ever read, so its pages stay intact (and readable by the old wallet).
//
// The two composed stores ARE the parameters: the guest-unlock flow passes
// device-key → real-wallet stores, a wallet switch passes SessionStore(A) →
// SessionStore(B). Meta (sessionId/cli/title/ts/lastDevice) is written verbatim
// into each destination page, so identity and ordering survive the copy.
//
// Idempotent: sessions already complete in the destination are skipped; a partial
// copy (an interrupted earlier run) resumes — only the missing tail is appended,
// matched by JSON prefix; a same-id session with DIFFERENT content is never touched.

import type { SessionStore } from "./store.js";

export interface MigrationReport {
  copied: number; // sessions that landed new content (full copy, resumed tail, or meta-only)
  skipped: number; // already complete, divergent same-id, or unreadable in the source
  messages: number; // messages appended to the destination across all sessions
}

export async function migrateSessions(
  source: SessionStore,
  destination: SessionStore,
): Promise<MigrationReport> {
  const report: MigrationReport = { copied: 0, skipped: 0, messages: 0 };
  const existing = new Set((await destination.listMine()).map((s) => s.sessionId));
  for (const meta of await source.listMine()) {
    // Per-session tolerance (mirrors listMine's): one undecryptable/corrupt session
    // must not abort the run — count it and keep copying the healthy ones.
    try {
      const session = await source.load(meta.sessionId);
      if (!session) {
        report.skipped += 1;
        continue;
      }
      let start = 0;
      if (existing.has(meta.sessionId)) {
        const current = await destination.load(meta.sessionId);
        if (!current || current.messages.length >= session.messages.length) {
          report.skipped += 1; // destination already complete (or ahead)
          continue;
        }
        const samePrefix = current.messages.every(
          (m, i) => JSON.stringify(m) === JSON.stringify(session.messages[i]),
        );
        if (!samePrefix) {
          report.skipped += 1; // divergent history — never overwrite
          continue;
        }
        start = current.messages.length; // resume: append only the missing tail
      }
      if (session.messages.length === 0) {
        await destination.recordMeta(meta); // meta-only session still shows up in lists
      } else {
        for (const m of session.messages.slice(start)) {
          await destination.appendMessage(meta, m);
          report.messages += 1;
        }
      }
      report.copied += 1;
    } catch {
      report.skipped += 1;
    }
  }
  return report;
}
