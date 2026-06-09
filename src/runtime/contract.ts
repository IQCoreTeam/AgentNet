// AgentNet runtime ⇄ surface CONTRACT.
// The single agreed interface between the engine (src/runtime) and any UI
// (surfaces/vscode, CLI). Both sides import only this. Implementations live
// in runtime/*; UIs call these and never touch internals.
//
// CODE-RULES: keep this the one source of these types. Don't redefine elsewhere.

// ── wallet ──────────────────────────────────────────────
// Two capabilities, one wallet:
//   signMessage      → derive the session encryption key (Track 1, off-chain)
//   WalletSigner     → sign Solana txs for the on-chain layer (Track 2)
// WalletSigner is iqlabs-sdk's own type (publicKey + signTransaction +
// signAllTransactions) — the SAME shape Phantom exposes, so any front-end
// (Phantom, Ledger, a local Keypair, mobile wallet) can satisfy it.
import type { WalletSigner } from "@iqlabs-official/solana-sdk/utils";

export interface Wallet extends WalletSigner {
  address: string; // base58 (== publicKey.toBase58())
  // used to derive the encryption key (iqlabs deriveX25519Keypair)
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
}

// ── storage (swappable: local file now → drive / on-chain later) ──
export interface StorageAdapter {
  // put = write/overwrite the whole blob (cloud adapters upload the full file).
  put(sessionId: string, blob: Uint8Array): Promise<void>;
  get(sessionId: string): Promise<Uint8Array | null>;
  list(): Promise<string[]>; // sessionIds this storage holds
  remove(sessionId: string): Promise<void>; // delete a session's stored blob
  // OPTIONAL append — adapters that support it (local file) get fast incremental
  // writes. Cloud adapters can omit it; the store falls back to get+put (which,
  // because the blob is an append-only log, still only adds content).
  append?(sessionId: string, chunk: Uint8Array): Promise<void>;
}

// ── chat message ────────────────────────────────────────
// `partial` lets us start with whole-turn messages and add streaming deltas
// later WITHOUT changing the UI contract: today emit one message (partial:false);
// later emit many (partial:true) then a final (partial:false).
export interface ChatMessage {
  role: "user" | "assistant" | "thinking" | "tool";
  text: string;
  ts: number;
  // which CLI produced this message. Stored per-message so a session continued
  // across CLIs renders each turn with the RIGHT engine badge — independent of
  // which tab is currently open. Optional for back-compat with older logs.
  cli?: "claude" | "codex";
  partial?: boolean; // true = streaming delta (future); absent/false = complete
}

// ── a running session (the handle the UI drives) ────────
export interface SessionHandle {
  readonly sessionId: string; // from the CLI's system/init
  readonly cli: "claude" | "codex";
  send(userText: string): void; // user input → CLI stdin
  onMessage(cb: (msg: ChatMessage) => void): void; // CLI output (UI renders)
  onTurnEnd(cb: () => void): void; // turn finished (runtime auto-saves here)
  stop(): void;
}

// ── the engine the UI calls ─────────────────────────────
export interface AgentRuntime {
  // spawn claude/codex and start a session. Pass sessionId to resume an old one.
  // The runtime auto-saves (encrypt → storage) on every turn end — the UI does nothing.
  startSession(opts: {
    cli: "claude" | "codex";
    cwd: string;
    sessionId?: string; // present = resume, absent = new
    model?: string;
  }): Promise<SessionHandle>;

  // list the wallet's saved sessions (for the UI's session list)
  listSessions(): Promise<SessionMeta[]>;

  // load a saved session's NEWEST page (paginated). Returns the latest messages +
  // whether older pages exist + an opaque cursor for loadMore. Call on resume to
  // repaint the recent history; scroll-to-top → loadMore.
  loadSession(sessionId: string): Promise<PageResult>;

  // load the page BEFORE `cursor` (older messages, for scroll-up). Prepend its
  // messages; use the returned cursor/hasMore for the next step.
  loadMore(sessionId: string, cursor: number): Promise<PageResult>;

  // delete a saved session (all its pages). The UI removes it from the list.
  deleteSession(sessionId: string): Promise<void>;
}

// paginated read result (newest-first; cursor walks toward older pages)
export interface PageResult {
  messages: ChatMessage[]; // one page, oldest→newest within the page
  hasMore: boolean; // older pages exist
  cursor: number | null; // pass to loadMore for the previous page; null = no older
}

// ── persisted forms ─────────────────────────────────────
export interface SessionMeta {
  sessionId: string;
  title: string; // derived (e.g. first user line)
  cli: "claude" | "codex";
  ts: number; // last updated
}

// what gets encrypted to storage (CLI-neutral, so codex↔claude + cross-device)
export interface CanonicalSession {
  sessionId: string;
  cli: "claude" | "codex";
  title: string;
  messages: ChatMessage[];
  ts: number;
}
