// The message contract between this UI and the core chat dispatcher, as it travels over
// surfaces/localhost's transport (POST /rpc for UI→server, SSE /events for server→UI).
// These mirror what packages/core's createChatSession sends/handles and what the HTML
// webview already speaks — this surface is a second client of the SAME protocol, not a
// new one. Keep these in sync with packages/core/src/chat/session.ts.

// ── shared payload shapes ──

export type Cli = "claude" | "codex";

export interface ChatMessage {
  role: "user" | "assistant" | "thinking" | "tool" | "summary";
  text: string;
  cli?: Cli;
  partial?: boolean; // true = append delta to the current bubble (streaming); false = done
  durationMs?: number;
  model?: string;
  tool?: {
    name?: string;
    command?: string;
    output?: string;
    exitCode?: number;
    file?: string;
    diff?: string;
  };
}

export interface SessionMeta {
  sessionId: string;
  title: string;
  ts: number;
}

export type ApprovalKind = "bash" | "edit" | "write" | "read" | "other";

export interface ApprovalRequest {
  id: string;
  cli: Cli;
  sessionId: string;
  tool: string;
  kind: ApprovalKind;
  title: string;
  command?: string;
  file?: string;
  diff?: string;
  input?: Record<string, unknown>;
}

export type ApprovalOutcome = "once" | "always" | "deny";

// ── UI → server (POST /rpc) ──

export type ClientMessage =
  | { type: "ready" }
  | { type: "new" }
  | { type: "newTab" }
  | { type: "open"; sessionId: string }
  | { type: "platform"; cli: Cli }
  | { type: "model"; model?: string }
  | { type: "send"; text: string }
  | { type: "loadMore"; cursor: number }
  | { type: "delete"; sessionId: string }
  | { type: "wallet" }
  | { type: "disconnectWallet" }
  | { type: "pickCloud" }
  | { type: "connectCloud"; kind: string; location?: string; authHeader?: string }
  | { type: "disconnectCloud" }
  | { type: "openCloud"; kind: string; location?: string }
  | { type: "approvalDecision"; id: string; outcome: ApprovalOutcome; reason?: string }
  // onboarding-only:
  | { type: "connectWallet"; address: string; signature: number[] }
  | { type: "startClaudeLogin" }
  | { type: "claudeAuthCode"; code: string }
  | { type: "cancelClaudeLogin" }
  | { type: "toast"; text: string };

// ── server → UI (SSE /events) ──

export type ServerMessage =
  | { type: "clear" }
  | { type: "message"; msg: ChatMessage }
  | { type: "turnEnd" }
  | { type: "page"; hasMore: boolean; cursor: number }
  | { type: "older"; messages: ChatMessage[]; hasMore: boolean; cursor: number }
  | { type: "sessions"; list: SessionMeta[]; activeId?: string }
  | { type: "loading" }
  | { type: "platform"; cli: Cli }
  | { type: "storage"; info: unknown; options: unknown }
  | { type: "cloudSync"; status: { ok: boolean; error?: string } | null }
  | { type: "wallet"; address: string | null }
  | { type: "approval"; req: ApprovalRequest }
  // onboarding-only:
  | { type: "init"; defaultPath: string | null; cloudKind: string | null }
  | { type: "walletConnected"; address: string | null; storageOptions: unknown }
  // claude subscription login: server reports whether login is needed, streams the OAuth
  // URL to open, and the final result after the user pastes their code.
  | { type: "cliStatus"; claude: "ok" | "no-login" | "missing"; codex: "ok" | "no-login" | "missing" }
  | { type: "claudeLoginUrl"; url: string }
  | { type: "claudeLoginStatus"; status: "done" | "error"; error?: string }
  | { type: "toast"; text: string };
