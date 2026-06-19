// The message contract between this UI and the core chat dispatcher, as it travels over
// surfaces/localhost's transport (POST /rpc for UI→server, SSE /events for server→UI).
// These mirror what packages/core's createChatSession sends/handles and what the HTML
// webview already speaks — this surface is a second client of the SAME protocol, not a
// new one. Keep these in sync with packages/core/src/chat/session.ts.

// Market types are defined once in packages/core and re-exported here so every surface
// that imports from this file gets compile-time checking on the market message contract.
export type { SkillCard, SkillDetail, MarketRequest, MarketEvent, RpcStatus, AgentProfile, Reputation } from "@iqlabs-official/agent-sdk";

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
  _pending?: true; // local-only: queued user message shown optimistically, replaced on server echo
}

export interface SessionMeta {
  sessionId: string;
  title: string;
  ts: number;
}

export type ApprovalKind = "bash" | "edit" | "write" | "read" | "question" | "plan" | "other";

// A choice question (claude's AskUserQuestion) carried inside an ApprovalRequest.
export interface ApprovalQuestion {
  id?: string;
  question: string;
  header?: string;
  multiSelect?: boolean;
  allowCustomInput?: boolean;
  secret?: boolean;
  options: { label: string; description?: string }[];
}

export interface ApprovalQuestionResponse {
  question: string;
  questionId?: string;
  selected: string[];
  text?: string;
}

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
  questions?: ApprovalQuestion[]; // kind === "question"
  plan?: string;                  // kind === "plan"
  input?: Record<string, unknown>;
  risk?: "danger";                // flagged destructive/irreversible action — surface should alarm
}

export type ApprovalOutcome = "once" | "always" | "deny";

// ── UI → server (POST /rpc) ──

export interface ImageInput {
  mime: string;
  dataBase64: string;
  name?: string;
}

export type ClientMessage =
  | { type: "ready" }
  | { type: "new" }
  | { type: "newTab" }
  | { type: "open"; sessionId: string }
  | { type: "platform"; cli: Cli }
  | { type: "model"; model?: string }
  | { type: "mode"; mode?: string }
  | { type: "effort"; effort?: string }
  | { type: "send"; text: string; images?: ImageInput[] }
  | { type: "interrupt" }
  | { type: "loadMore"; cursor: number }
  | { type: "delete"; sessionId: string }
  | { type: "wallet" }
  | { type: "getCliStatus" }
  | { type: "disconnectWallet" }
  | { type: "pickCloud" }
  | { type: "connectCloud"; kind: string; location?: string; authHeader?: string }
  | { type: "disconnectCloud" }
  | { type: "openCloud"; kind: string; location?: string }
  // passive skill-shopping toggle (issue #21)
  | { type: "getSkillShopping" }
  | { type: "setSkillShopping"; on: boolean }
  | { type: "approvalDecision"; id: string; outcome: ApprovalOutcome; reason?: string; updatedInput?: Record<string, unknown>; questionResponses?: ApprovalQuestionResponse[] }
  // setup/auth:
  | { type: "connectWallet"; address: string; signature: number[] }
  | { type: "startClaudeLogin" }
  | { type: "claudeAuthCode"; code: string }
  | { type: "cancelClaudeLogin" }
  | { type: "startCodexLogin" }
  | { type: "cancelCodexLogin" }
  | { type: "submitCodexApiKey"; key: string }
  | { type: "startGoogleLogin" }
  | { type: "googleAuthCode"; code: string }
  | { type: "cancelGoogleLogin" }
  | { type: "setGoogleCredentials"; clientId: string; clientSecret?: string }
  | { type: "toast"; text: string }
  // ── market (UI→server) ──
  | { type: "searchSkills"; query: string; kind?: "skill" | "workflow" }
  | { type: "getSkillDetail"; mint: string }
  | { type: "buySkill"; skillId: string; creatorWallet?: string }
  | { type: "disposeSkill"; skillId: string }
  | { type: "reEquipSkill"; skillId: string }
  | { type: "ownedSkills" }
  | { type: "getBalance" }
  | { type: "getRpcStatus" }
  | { type: "submitHeliusKey"; key: string }
  | { type: "useDefaultRpc" }
  | { type: "listAgents" }
  | { type: "getAgentProfile"; wallet: string }
  | { type: "buyAllSkills"; wallet: string }
  | { type: "postNote"; skillId: string; skillType?: "skill" | "workflow"; text: string; gitLink?: string }
  | { type: "postAgentNote"; agentWallet: string; text: string; gitLink?: string }
  | {
      type: "publishSkill";
      name: string;
      description: string;
      text: string;
      category?: string;
      hashtags?: string[];
      priceSol: string;
      image?: string;
    }
  | { type: "submitGithubToken"; token: string }
  | { type: "clearGithubToken" }
  | { type: "getGithubStatus" };

// ── server → UI (SSE /events) ──

export type ServerMessage =
  | { type: "clear" }
  | { type: "usage"; contextTokens: number }
  | { type: "message"; msg: ChatMessage }
  | { type: "turnEnd" }
  | { type: "page"; hasMore: boolean; cursor: number }
  | { type: "older"; messages: ChatMessage[]; hasMore: boolean; cursor: number }
  | { type: "sessions"; list: SessionMeta[]; activeId?: string }
  | { type: "loading" }
  | { type: "platform"; cli: Cli }
  | { type: "storage"; info: unknown; options: unknown; googleCredsConfigured?: boolean }
  | { type: "cloudSync"; status: { ok: boolean; error?: string } | null }
  | { type: "wallet"; address: string | null }
  | { type: "skillShopping"; on: boolean }
  | { type: "approval"; req: ApprovalRequest }
  // setup/auth:
  | { type: "init"; defaultPath: string | null; cloudKind: string | null }
  | { type: "walletConnected"; address: string | null; storageOptions: unknown; storageConfigured?: boolean }
  // claude subscription login: server reports whether login is needed, streams the OAuth
  // URL to open, and the final result after the user pastes their code.
  | { type: "cliStatus"; claude: "ok" | "no-login" | "missing"; codex: "ok" | "no-login" | "missing" }
  | { type: "claudeLoginUrl"; url: string }
  | { type: "claudeLoginStatus"; status: "done" | "error"; error?: string }
  // codex device-auth: server streams the URL + one-time code; CLI auto-polls (no code submittal).
  | { type: "codexLoginChallenge"; url: string; code: string }
  | { type: "codexLoginStatus"; status: "done" | "error"; error?: string }
  | { type: "googleLoginUrl"; url: string }
  | { type: "googleLoginStatus"; status: "done" | "error"; error?: string }
  // result of saving user-supplied Google OAuth client credentials (setGoogleCredentials).
  | { type: "googleCredsStatus"; status: "saved" | "error"; error?: string }
  | { type: "openUrl"; url: string }
  | { type: "toast"; text: string }
  // ── market (server→UI) ──
  | { type: "searchResults"; results: import("@iqlabs-official/agent-sdk").SkillCard[] }
  | { type: "searchError"; message: string }
  | { type: "skillDetail"; detail: import("@iqlabs-official/agent-sdk").SkillDetail }
  | { type: "skillDoc"; name: string; text: string | null }
  | { type: "buyResult"; skillId: string; ok: boolean; slug?: string; error?: string }
  | { type: "disposeResult"; skillId: string; ok: boolean; slug?: string; error?: string }
  | { type: "reEquipResult"; skillId: string; ok: boolean; slug?: string; error?: string }
  | { type: "ownedSkills"; names: string[]; mints?: Record<string, string>; disposedMints?: Record<string, string> }
  | { type: "balance"; lamports: number | null }
  | { type: "skillActive"; name: string }
  | { type: "rpcStatus"; status: import("@iqlabs-official/agent-sdk").RpcStatus }
  | { type: "postNoteResult"; skillId: string; ok: boolean; error?: string }
  | { type: "notes"; skillId: string; notes: unknown[] }
  | { type: "agents"; agents: unknown[] }
  | { type: "agentProfile"; profile: import("@iqlabs-official/agent-sdk").AgentProfile }
  | { type: "buyAllResult"; wallet: string; ok: boolean; bought: number; failed: number; error?: string }
  | { type: "agentNoteResult"; agentWallet: string; ok: boolean; error?: string }
  | { type: "publishResult"; ok: boolean; mint?: string; error?: string }
  | { type: "githubStatus"; hasToken: boolean; masked?: string };
