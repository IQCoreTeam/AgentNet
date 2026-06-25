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
import type { ApprovalChannel } from "./approval/channel.js";
import type { MarketEvent } from "../chat/marketMessages.js";

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
  // OPTIONAL fast/local-only listing. Adapters with a slow tier (the mirror's cloud
  // mirror) expose JUST the local tier here, so callers that only need to locate an
  // already-local session's pages can skip a network round-trip. Single-tier adapters
  // omit it and callers fall back to list().
  listLocal?(): Promise<string[]>;
}

// ── chat message ────────────────────────────────────────
// `partial` lets us start with whole-turn messages and add streaming deltas
// later WITHOUT changing the UI contract: today emit one message (partial:false);
// later emit many (partial:true) then a final (partial:false).
export interface ChatMessage {
  // "summary" = a compaction record: its `text` REPLACES the prior turns for context
  // purposes. Every CLI compacts its own way (claude writes an isCompactSummary user
  // line; codex writes a `compacted` record) but we normalize all of them to this one
  // neutral shape — a plain text summary — so any engine (and any future platform) can
  // read it. See plans/compact-and-state-sync.md.
  role: "user" | "assistant" | "thinking" | "tool" | "summary";
  text: string;
  ts: number;
  // which CLI produced this message. Stored per-message so a session continued
  // across CLIs renders each turn with the RIGHT engine badge — independent of
  // which tab is currently open. Optional for back-compat with older logs.
  cli?: "claude" | "codex";
  // For role:"tool" — structured action so the UI can render it nicely (a bash
  // block, a diff, a file op) instead of opaque text. `text` still holds a short
  // human summary for fallback/older readers. All fields optional per tool kind.
  tool?: ToolAction;
  // For role:"summary" — ts of the last turn this summary subsumes; inject drops
  // turns at/before it and folds the summary in as leading context. Absent = the
  // summary subsumes everything before its own ts.
  replacesUpTo?: number;
  partial?: boolean; // true = streaming delta (future); absent/false = complete
  // For role:"user" — how many images the user attached to this turn. ONLY a count is
  // stored (never the base64 payload — that would bloat the encrypted log); the live UI
  // renders real thumbnails from the in-memory attachments, history shows a count chip.
  imageCount?: number;
}

// An image attached to a user turn. `dataBase64` is the RAW base64 (no data: prefix).
// Neutral across engines: claude takes it inline as a base64 content block; codex needs
// a file path, so the spawn layer writes it to a temp file and passes that.
export interface ImageInput {
  mime: string; // e.g. "image/png"
  dataBase64: string; // raw base64, no "data:...;base64," prefix
  name?: string; // original filename, for display only
}

// One tool/agent action surfaced in the transcript (bash run, file edit, read…).
export interface ToolAction {
  name: string; // "Bash" | "Edit" | "Write" | "Read" | "Agent" | command kind…
  command?: string; // shell command (Bash / codex command_execution)
  output?: string; // command stdout/stderr or result text
  exitCode?: number; // process exit code, when known
  file?: string; // target file (Edit / Write / Read)
  diff?: string; // unified-ish diff for edits ("-old" / "+new" lines)
}

// ── a running session (the handle the UI drives) ────────
export interface SessionHandle {
  readonly sessionId: string; // from the CLI's system/init
  readonly cli: "claude" | "codex";
  send(userText: string, images?: ImageInput[]): void; // user input (+ attached images) → CLI
  runSlashCommand?(command: string, arg?: string): void; // native CLI slash command, not a chat turn
  onMessage(cb: (msg: ChatMessage) => void): void; // CLI output (UI renders)
  onTurnEnd(cb: () => void): void; // turn finished (runtime auto-saves here)
  onSkill(cb: (name: string) => void): void; // a skill fired → UI "Casting <skill>" cue
  // real context-window occupancy (tokens) reported by the engine each turn. Optional
  // for the UI to use (e.g. a context-left meter); surfaces may ignore it.
  onUsage(cb: (contextTokens: number) => void): void;
  // interrupt the CURRENT turn but keep the session alive (claude q.interrupt / codex
  // turn/interrupt) — the next send continues the same conversation. Distinct from
  // stop(), which tears the whole handle down.
  interrupt(): void;
  stop(): void;
  updateMode?(mode: string): void;
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
    // permission/approval mode. claude → SDK permissionMode (default | acceptEdits |
    // plan | bypassPermissions); codex → a sandbox+approval preset key (readonly |
    // auto | full). Omit → the engine's safe default (claude "default", codex "auto").
    mode?: string;
    // token streaming. The engine emits partial assistant deltas (ChatMessage.partial:true)
    // followed by a final partial:false message. Defaults ON: codex always streams, and claude
    // streams unless this is explicitly false (set stream:false to restore whole-turn behavior).
    // Partials are rendered live but NOT persisted — only the final message is written to the log.
    stream?: boolean;
    // who decides tool approvals for THIS session. Per-session (not per-runtime) so
    // multiple chat panels sharing one runtime each route approvals to their OWN
    // panel. Omit → the runtime's default channel (or auto-allow).
    approval?: ApprovalChannel;
    // Optional Codex API Key (Stage 1)
    apiKey?: string;
    // Ephemeral (side-channel /btw) session that doesn't save messages to the store.
    ephemeral?: boolean;
    // Reasoning effort level (claude: adaptive thinking depth; codex: reasoning_effort).
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    // Surface→webview channel for marketplace events emitted by the agent's OWN tool calls
    // (buy_skill done, publish_skill progress/result). Lets a chat-driven buy/publish reuse
    // the same celebration/toast/gauge the UI buy gets. Omit → no agent-tool market events.
    onMarketEvent?: (e: MarketEvent) => void;
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
  lastDevice?: { id: string; label: string };
}

// what gets encrypted to storage (CLI-neutral, so codex↔claude + cross-device)
export interface CanonicalSession {
  sessionId: string;
  cli: "claude" | "codex";
  title: string;
  messages: ChatMessage[];
  ts: number;
  lastDevice?: { id: string; label: string };
}
