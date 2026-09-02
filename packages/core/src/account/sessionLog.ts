// The on-disk session format: an APPEND-ONLY log of encrypted records, one per
// line (JSONL). Each record is independently encrypted, so new messages append
// without rewriting old ones. claude and codex share one log per sessionId, so
// they continue the same conversation. Reading = decrypt every line in order.
//
// This file is the single source of the storage format — change it here only.

import type { ChatMessage, CanonicalSession } from "../runtime/contract.js";
import { coerceEngineKey, type EngineKey } from "../runtime/engineRegistry.js";
import { encryptForWallet, decryptForWallet, type SessionKey } from "../core/crypto.js";

// A log record: either session meta (first line) or one chat message.
// A page may hold several meta records (settings/device updates append one);
// decode is last-record-wins, and each meta is a FULL snapshot of the session's
// current settings, so an absent model/effort means "engine default", not "unchanged".
type LogRecord =
  | { kind: "meta"; sessionId: string; cli: string; title: string; ts: number; lastDevice?: { id: string; label: string }; model?: string; effort?: string }
  | { kind: "msg"; msg: ChatMessage };

const NL = new TextEncoder().encode("\n");

// Encrypt one record → a single "<cipher-json>\n" chunk to append.
export async function encodeRecord(key: SessionKey, rec: LogRecord): Promise<Uint8Array> {
  const plain = new TextEncoder().encode(JSON.stringify(rec));
  const enc = await encryptForWallet(key, plain); // already JSON bytes of {senderPub,iv,ciphertext}
  const out = new Uint8Array(enc.length + NL.length);
  out.set(enc, 0);
  out.set(NL, enc.length);
  return out;
}

// Convenience encoders for the two record kinds.
export function metaRecord(s: Omit<CanonicalSession, "messages">): LogRecord {
  return { kind: "meta", sessionId: s.sessionId, cli: s.cli, title: s.title, ts: s.ts, lastDevice: s.lastDevice, model: s.model, effort: s.effort };
}
export function msgRecord(msg: ChatMessage): LogRecord {
  return { kind: "msg", msg };
}

// Decode a full log blob → a CanonicalSession (replays records in order).
export async function decodeLog(
  key: SessionKey,
  blob: Uint8Array,
): Promise<CanonicalSession | null> {
  const text = new TextDecoder().decode(blob).trim();
  if (!text) return null;

  let sessionId = "";
  let cli: EngineKey = "claude";
  let title = "";
  let ts = 0;
  let lastDevice: { id: string; label: string } | undefined = undefined;
  let model: string | undefined = undefined;
  let effort: CanonicalSession["effort"] = undefined;
  const messages: ChatMessage[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const plain = await decryptForWallet(key, new TextEncoder().encode(line));
    const rec = JSON.parse(new TextDecoder().decode(plain)) as LogRecord;
    if (rec.kind === "meta") {
      sessionId = rec.sessionId;
      cli = coerceEngineKey(rec.cli); // unknown cli strings read as codex-like
      title = rec.title;
      ts = rec.ts;
      lastDevice = rec.lastDevice;
      model = rec.model;
      effort = rec.effort as CanonicalSession["effort"];
    } else {
      messages.push(rec.msg);
    }
  }

  if (!sessionId) return null;
  return { sessionId, cli, title, messages, ts, lastDevice, model, effort };
}
