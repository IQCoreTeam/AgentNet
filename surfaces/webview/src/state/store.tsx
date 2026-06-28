// The UI state, driven entirely by server→UI events. The dispatcher (packages/core) is
// the source of truth; this reducer just projects its event stream into render state.
// One reducer, one action per ServerMessage type — no multi-harness abstraction (we run
// one agent; codex is a tab, not a second backend).

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { Transport } from "../transport/client";
import { openExternalUrl } from "../platform/openExternalUrl";
import { isAndroidWallet, signAndroidTransaction } from "../onboarding/androidWallet";
import { providerSignBase64 } from "@iqlabs-official/agent-sdk/account/webWallet";
import type {
  AgentProfile,
  ApprovalRequest,
  ChatMessage,
  Cli,
  ClientMessage,
  ImageInput,
  ServerMessage,
  SessionMeta,
  SkillCard,
  SkillDetail,
  RpcStatus,
  Reputation,
} from "../transport/protocol";

// A rendered log entry. We keep messages as-is and stream into the last assistant/
// thinking bubble when `partial` is set, matching the HTML webview's bubble model.
export type EngineStatus = "ok" | "no-login" | "missing";

export interface State {
  phase:
    | "connecting"
    | "onboarding"
    | "storageSelect"
    | "engineSelect"
    | "claudeAuth"
    | "codexAuth"
    | "chat";
  // market overlay (accessible from chat phase via "Markets" button)
  marketOpen: boolean;
  marketInitialView: "browse" | "agents" | "owned";
  marketTab: "skill" | "workflow";
  marketQuery: string;
  marketResults: SkillCard[] | null;
  marketSearching: boolean;
  marketSearchError: string | null;
  marketDetail: SkillDetail | null;
  marketOwned: string[];
  marketOwnedMints: Record<string, string>;
  marketOwnedCards: SkillCard[]; // wallet's on-chain owned skill cards (My Skills grid)
  marketDisposed: Record<string, string>;
  marketBalance: number | null;
  rpcStatus: RpcStatus | null;
  publishResult: { ok: boolean; mint?: string; error?: string } | null;
  // Live publish progress while a multi-signature publish runs (web wallet); null when idle.
  publishProgress: { phase: "store" | "mint" | "list"; signed: number; percent?: number; kind: "skill" | "workflow" } | null;
  // Kind of the in-flight/just-finished publish — outlives publishProgress so the success
  // celebration can tint to match (skill = violet, workflow = amber). Cleared with the result.
  publishKind: "skill" | "workflow" | null;
  // Skills/workflows currently casting (god-mode glow). A list, not one, so a workflow and
  // the skills it chains can stack; each is tinted by kind (workflow = amber, skill = violet).
  firingSkills: { name: string; kind: "skill" | "workflow" }[];
  walletAddress: string | null;
  cli: Cli;
  googleLoginUrl: string | null;
  googleLoginError: string | null;
  // per-engine install/login status from the post-wallet `cliStatus` event, kept so the
  // engine picker can show a live badge next to each choice (null until it arrives).
  cliReport: { claude: EngineStatus; codex: EngineStatus } | null;
  // claude subscription login during onboarding.
  claudeLoginUrl: string | null;
  claudeLoginError: string | null;
  // codex device-auth during onboarding: URL + one-time code the user enters on the page.
  // CLI auto-polls; no code submission from UI side.
  codexLoginUrl: string | null;
  codexLoginCode: string | null;
  codexLoginError: string | null;
  log: ChatMessage[];
  sessions: SessionMeta[];
  // false until the FIRST `sessions` list lands from the server. Lets the drawer show a
  // "syncing…" state on initial login (while listMine() does its cloud round-trip) instead
  // of a misleading "No chats yet" before the list has actually been fetched.
  sessionsSynced: boolean;
  activeSessionId?: string;
  approvals: ApprovalRequest[];
  storage: { info: unknown; options: unknown; googleCredsConfigured?: boolean } | null;
  googleCredsError: string | null;
  cloudSync: { ok: boolean; error?: string } | null;
  typing: boolean; // a turn is in flight (typing dots)
  loading: boolean; // cross-CLI carry veil
  hasMore: boolean;
  cursor: number;
  toast: string | null;
  buyCelebrate: boolean;
  buyCelebrateLabel: string | null; // bought skill's slug/name for the purchase card
  contextTokens?: number;
  contextWindow?: number;
  isCompacting: boolean;
  currentModel?: string;
  queuePending: number;
  agents: Reputation[];
  agentProfile: AgentProfile | null;
  agentProfileLoading: boolean;
  agentsLoading: boolean;
  githubStatus: { hasToken: boolean; masked?: string } | null;
  workRepoResult: { ok: boolean; count?: number; repo?: string; error?: string; at: number } | null;
  modeByCli: Record<Cli, string>;
}

// An approval belongs to the chat the user is VIEWING — so it docks inline + freezes the
// composer here — rather than only pinging a notification for a backgrounded session. True
// when it matches the active session, carries no session, or no chat is selected yet.
export function isApprovalForView(a: { sessionId?: string }, activeSessionId?: string): boolean {
  return !a.sessionId || !activeSessionId || a.sessionId === activeSessionId;
}

const initialState: State = {
  phase: "connecting",
  walletAddress: null,
  cli: "claude",
  cliReport: null,
  claudeLoginUrl: null,
  googleLoginUrl: null,
  googleLoginError: null,
  claudeLoginError: null,
  codexLoginUrl: null,
  codexLoginCode: null,
  codexLoginError: null,
  log: [],
  sessions: [],
  sessionsSynced: false,
  approvals: [],
  storage: null,
  googleCredsError: null,
  cloudSync: null,
  typing: false,
  loading: false,
  hasMore: false,
  cursor: 0,
  toast: null,
  buyCelebrate: false,
  buyCelebrateLabel: null,
  marketOpen: false,
  marketInitialView: "browse",
  marketTab: "skill",
  marketQuery: "",
  marketResults: null,
  marketSearching: false,
  marketSearchError: null,
  marketDetail: null,
  marketOwned: [],
  marketOwnedMints: {},
  marketOwnedCards: [],
  marketDisposed: {},
  marketBalance: null,
  rpcStatus: null,
  publishResult: null,
  publishProgress: null,
  publishKind: null,
  firingSkills: [],
  currentModel: undefined,
  queuePending: 0,
  agents: [],
  agentProfile: null,
  agentProfileLoading: false,
  agentsLoading: false,
  githubStatus: null,
  workRepoResult: null,
  isCompacting: false,
  modeByCli: {
    claude: "acceptEdits",
    codex: "auto",
  },
};

// Append a streamed message: if the incoming partial continues the same role/cli as the
// tail bubble, merge text into it; otherwise start a new bubble. A non-partial message is
// a complete bubble (or a tool/summary/user entry) pushed as-is.
// When server echoes a user message that matches a pending (_pending=true) optimistic bubble,
// replace the pending one instead of appending — avoids duplicate user bubbles on queue flush.
function appendMessage(log: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const tail = log[log.length - 1];
  // Streaming assistant/thinking bubbles: the engines emit cumulative snapshots — each
  // event carries the FULL text so far (replace-semantics), NOT just the new delta. While
  // the tail bubble is the in-progress partial of the same role/cli, REPLACE it with the
  // latest snapshot. This also covers the final non-partial block that finalizes the bubble
  // (clears `partial`), so it replaces the streamed bubble instead of appending a duplicate.
  // (Concatenating tail.text + msg.text double-counts the cumulative text — that produced
  // garbled output like "YepYep,Yep, alive…" for codex.)
  const continuesStream =
    tail &&
    tail.partial &&
    tail.role === msg.role &&
    tail.cli === msg.cli &&
    (msg.role === "assistant" || msg.role === "thinking");
  if (continuesStream) {
    return [...log.slice(0, -1), { ...tail, ...msg }];
  }
  // Server echoes user message → find and replace the matching pending bubble.
  if (msg.role === "user" && !msg.partial) {
    let pendingIdx = -1;
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i];
      if (m._pending && m.role === "user" && m.text === msg.text) {
        pendingIdx = i;
        break;
      }
    }
    if (pendingIdx !== -1) {
      const next = [...log];
      next[pendingIdx] = msg; // replace pending with confirmed
      return next;
    }
  }
  return [...log, msg];
}

// Actions = server events (projected verbatim) + a few local-only UI effects the
// dispatcher doesn't round-trip (optimistic typing dots, removing an answered approval
// from the dock, dismissing a toast).
type LocalAction =
  | { type: "__compactStart" }
  | { type: "__typing" }
  | { type: "__removeApproval"; id: string }
  | { type: "__clearToast" }
  | { type: "__selectEngine"; cli: Cli }
  | { type: "__finishStorage" }
  | { type: "__savePlan"; text: string }
  | { type: "__openMarket"; initialView?: "browse" | "agents" | "owned" }
  | { type: "__closeMarket" }
  | { type: "__setMarketTab"; tab: "skill" | "workflow" }
  | { type: "__setMarketQuery"; query: string }
  | { type: "__marketSearching" }
  | { type: "__clearMarketDetail" }
  | { type: "__clearPublishResult" }
  | { type: "__modelChange"; model: string }
  | { type: "__queueMsg"; text: string }
  | { type: "__dequeueMsg" }
  | { type: "__loadingAgents" }
  | { type: "__loadingAgentProfile" }
  | { type: "__clearAgentProfile" }
  | { type: "__changeMode"; mode: string }
  | { type: "__clearFiringSkill" }
  | { type: "__setToast"; text: string }
  | { type: "__openingSession"; sessionId: string }
  | { type: "__newChat" }
  | { type: "__clearCelebrate" };
type Action = ServerMessage | LocalAction;

function reducer(state: State, ev: Action): State {
  switch (ev.type) {
    case "__typing":
      return { ...state, typing: true };
    case "__removeApproval":
      return { ...state, approvals: state.approvals.filter((a) => a.id !== ev.id) };
    case "__clearToast":
      return { ...state, toast: null };
    case "__setToast":
      return { ...state, toast: ev.text };
    case "__selectEngine": {
      // No "not installed" / "checking sign-in" alerts: just route. Report not in yet ->
      // wait (PickEngine re-fires when it arrives). ok -> chat; otherwise (no-login or
      // missing) -> the engine's own auth screen handles sign-in / install.
      if (!state.cliReport) return state;
      const status = state.cliReport[ev.cli];
      if (status === "ok") return { ...state, cli: ev.cli, phase: "chat" };
      return { ...state, cli: ev.cli, phase: ev.cli === "claude" ? "claudeAuth" : "codexAuth" };
    }
    case "init":
      // `init` means this SSE client is attached to onboarding, not chat. If the server
      // still has the wallet (mid-onboarding reconnect before storage/runtime exists),
      // preserve the current wallet-derived phase. If the server explicitly says it has
      // no wallet, the app/server process restarted and the local wallet state is stale:
      // clear it so sends don't get stuck in a chat UI backed by an onboarding handler.
      if (ev.hasWallet === false) return { ...state, walletAddress: null, phase: "onboarding" };
      if (state.walletAddress) return state;
      return { ...state, phase: "onboarding" };
    case "walletConnected":
      // Wallet is in. If storage was already configured on this device (returning user),
      // skip the storage picker entirely and go straight to engine select — the gdrive
      // choice + token persist, so re-walking it (and re-auth) is pointless. Only a true
      // first run shows the picker.
      return { ...state, walletAddress: ev.address, phase: ev.storageConfigured ? "engineSelect" : "storageSelect" };
    case "cliStatus":
      // After wallet: don't force claude. Record both engines' status and show the engine
      // picker so the user chooses which one to activate. The chosen engine then runs its
      // own gate (claude/codex login if needed) via __selectEngine.
      if (state.phase === "chat" && ev[state.cli] === "no-login") {
        return { ...state, cliReport: { claude: ev.claude, codex: ev.codex }, phase: state.cli === "claude" ? "claudeAuth" : "codexAuth" };
      }
      if (state.phase === "chat" && ev[state.cli] === "missing") {
        return { ...state, cliReport: { claude: ev.claude, codex: ev.codex }, phase: "engineSelect" };
      }
      return { ...state, cliReport: { claude: ev.claude, codex: ev.codex } };
    case "__finishStorage":
      return { ...state, phase: "engineSelect" };
    case "googleLoginUrl":
      return { ...state, googleLoginUrl: ev.url, googleLoginError: null };
    case "googleLoginStatus":
      return ev.status === "done"
        ? { ...state, googleLoginUrl: null, googleLoginError: null, phase: "engineSelect" }
        : { ...state, googleLoginUrl: null, googleLoginError: ev.error ?? "Login failed." };
    case "openUrl":
      openExternalUrl(ev.url);
      return state;
    case "claudeLoginUrl":
      return { ...state, claudeLoginUrl: ev.url, claudeLoginError: null };
    case "claudeLoginStatus":
      return ev.status === "done"
        ? { ...state, cli: "claude", phase: "chat", cliReport: state.cliReport ? { ...state.cliReport, claude: "ok" } : state.cliReport, claudeLoginUrl: null, claudeLoginError: null }
        : { ...state, claudeLoginUrl: null, claudeLoginError: ev.error ?? "Login failed." };
    case "codexLoginChallenge":
      return { ...state, codexLoginUrl: ev.url, codexLoginCode: ev.code, codexLoginError: null };
    case "codexLoginStatus":
      return ev.status === "done"
        ? { ...state, cli: "codex", phase: "chat", cliReport: state.cliReport ? { ...state.cliReport, codex: "ok" } : state.cliReport, codexLoginUrl: null, codexLoginCode: null, codexLoginError: null }
        : { ...state, codexLoginUrl: null, codexLoginCode: null, codexLoginError: ev.error ?? "Login failed." };
    case "usage":
      return {
        ...state,
        contextTokens: ev.contextTokens,
        contextWindow: ev.contextWindow ?? state.contextWindow,
      };
    case "__compactStart":
      return { ...state, isCompacting: true };
    case "compacted":
      return { ...state, isCompacting: false, contextTokens: undefined, toast: "Context compacted — conversation history summarised to free space." };
    case "clear":
      // repaint() sends `clear` on every session open. Keep the approvals that belong to the
      // session now being opened — otherwise tapping a notification to answer a backgrounded
      // session's question would wipe that very question (the engine is still awaiting it).
      // activeSessionId is already the opened session here (set optimistically on open).
      return { ...state, log: [], approvals: state.approvals.filter((a) => isApprovalForView(a, state.activeSessionId)), typing: false, loading: false, contextTokens: undefined, contextWindow: undefined, firingSkills: [] };
    case "message":
      return { ...state, log: appendMessage(state.log, ev.msg) };
    case "turnEnd":
      return { ...state, typing: false, firingSkills: [] };
    case "page":
      return { ...state, hasMore: ev.hasMore, cursor: ev.cursor, loading: false };
    case "older":
      return {
        ...state,
        log: [...ev.messages, ...state.log],
        hasMore: ev.hasMore,
        cursor: ev.cursor,
      };
    case "sessions":
      // Only ADOPT the server's activeId when the UI has no selection yet. pushSessions()
      // runs after every open and its listMine can take 2-3s on mobile; if the user taps
      // another chat during that window, the late `sessions` frame would otherwise stomp
      // activeSessionId back to the PREVIOUS chat — the "tap chat 2, get chat 1, tap again
      // to finally get 2" off-by-one. The optimistic __openingSession owns the active id;
      // the server's id is only needed to restore one on a fresh load (or after __newChat,
      // which clears the selection).
      return {
        ...state,
        phase: "chat",
        sessions: ev.list,
        sessionsSynced: true,
        activeSessionId: state.activeSessionId ?? ev.activeId,
      };
    case "loading":
      return { ...state, loading: true };
    // Optimistic session switch: the moment the user taps a chat, flip the active id (so
    // the header title swaps off "New chat" instantly), clear the old log, and show the
    // loading state — instead of waiting for the server's clear→loadSession→sessions
    // round-trip, which left the screen on the stale chat with no feedback. The server's
    // messages/page/sessions then reconcile this.
    case "__openingSession":
      return { ...state, activeSessionId: ev.sessionId, loading: true, log: [], typing: false, hasMore: false, firingSkills: [] };
    case "__newChat":
      return {
        ...state,
        activeSessionId: undefined,
        log: [],
        approvals: [],
        typing: false,
        loading: false,
        hasMore: false,
        cursor: 0,
        contextTokens: undefined,
        contextWindow: undefined,
        firingSkills: [],
      };
    case "platform":
      return { ...state, cli: ev.cli };
    case "storage":
      return { ...state, storage: { info: ev.info, options: ev.options, googleCredsConfigured: ev.googleCredsConfigured } };
    case "googleCredsStatus":
      return ev.status === "saved"
        ? { ...state, googleCredsError: null, storage: { ...(state.storage ?? { info: null, options: [] }), googleCredsConfigured: true } }
        : { ...state, googleCredsError: ev.error ?? "Failed to save credentials." };
    case "cloudSync":
      return { ...state, cloudSync: ev.status };
    case "wallet":
      return { ...state, walletAddress: ev.address };
    case "approval":
      return { ...state, approvals: [ev.req, ...state.approvals] };
    case "notice":
      return { ...state, toast: ev.text };
    case "status": {
      const s = ev.status;
      const win = state.contextWindow ?? (s.cli === "codex" ? 256_000 : 200_000);
      const fmtK = (n: number) => n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
      const ctx = s.contextTokens === undefined
        ? ""
        : `, ctx ${fmtK(s.contextTokens)} / ${fmtK(win)} (${Math.round((s.contextTokens / win) * 100)}%)`;
      return {
        ...state,
        toast: `${s.cli}: model ${s.model ?? "default"}, mode ${s.mode ?? "default"}, effort ${s.effort ?? "default"}${ctx}`,
      };
    }
    case "toast":
      return { ...state, toast: ev.text };
    // ── market local actions ──
    case "__savePlan":
      return { ...state, log: [...state.log, { role: "summary" as const, text: `Saved plan\n\n${ev.text}` }] };
    case "__openMarket":
      return { ...state, marketOpen: true, marketInitialView: ev.initialView ?? "browse" };
    case "__closeMarket":
      return { ...state, marketOpen: false, marketDetail: null, publishResult: null };
    case "__setMarketTab":
      return { ...state, marketTab: ev.tab, marketResults: null, marketDetail: null };
    case "__setMarketQuery":
      return { ...state, marketQuery: ev.query };
    case "__marketSearching":
      return { ...state, marketSearching: true, marketSearchError: null };
    case "__clearMarketDetail":
      return { ...state, marketDetail: null };
    case "__clearPublishResult":
      return { ...state, publishResult: null, publishProgress: null, publishKind: null };
    case "__modelChange":
      return {
        ...state,
        currentModel: ev.model,
        log: [...state.log, { role: "summary" as const, text: `─── model: ${ev.model} ───` }],
      };
    case "__queueMsg":
      return {
        ...state,
        queuePending: state.queuePending + 1,
        log: [...state.log, { role: "user" as const, text: ev.text, _pending: true }],
      };
    case "__dequeueMsg":
      return { ...state, queuePending: Math.max(0, state.queuePending - 1) };
    // ── market server events ──
    case "searchResults":
      return { ...state, marketResults: ev.results, marketSearching: false, marketSearchError: null };
    case "searchError":
      return { ...state, marketSearching: false, marketSearchError: ev.message };
    case "skillDetail":
      return { ...state, marketDetail: ev.detail };
    case "buyResult":
      return {
        ...state,
        toast: ev.ok ? `Bought! Slug: ${ev.slug ?? ev.skillId}` : `Buy failed: ${ev.error ?? "unknown"}`,
        marketOwned: ev.ok ? [...state.marketOwned, ev.slug ?? ev.skillId] : state.marketOwned,
        buyCelebrate: ev.ok ? true : state.buyCelebrate,
        buyCelebrateLabel: ev.ok ? (ev.slug ?? ev.skillId) : state.buyCelebrateLabel,
      };
    case "disposeResult":
      return {
        ...state,
        toast: ev.ok ? "Skill removed." : `Remove failed: ${ev.error ?? "unknown"}`,
        marketOwned: ev.ok ? state.marketOwned.filter((name) => name !== (ev.slug ?? ev.skillId)) : state.marketOwned,
        marketDisposed: ev.ok ? { ...state.marketDisposed, [ev.slug ?? ev.skillId]: ev.skillId } : state.marketDisposed,
      };
    case "reEquipResult":
      return {
        ...state,
        toast: ev.ok ? "Skill re-equipped." : `Re-equip failed: ${ev.error ?? "unknown"}`,
        marketOwned: ev.ok ? [...state.marketOwned, ev.slug ?? ev.skillId] : state.marketOwned,
        marketDisposed: ev.ok
          ? Object.fromEntries(Object.entries(state.marketDisposed).filter(([, mint]) => mint !== ev.skillId && mint !== ev.slug))
          : state.marketDisposed,
      };
    case "ownedSkills":
      return {
        ...state,
        marketOwned: Array.isArray(ev.names) ? ev.names : [],
        marketOwnedMints: ev.mints ?? {},
        // Only chain-sourced emits carry `cards`; keep the existing grid on a names-only
        // emit (chat panel / post-buy refresh) instead of blanking My Skills.
        marketOwnedCards: ev.cards ?? state.marketOwnedCards,
        marketDisposed: ev.disposedMints ?? {},
      };
    case "balance":
      return { ...state, marketBalance: ev.lamports };
    case "rpcStatus":
      return { ...state, rpcStatus: ev.status };
    case "skillActive": {
      // The cast name is the SKILL.md slug; a workflow we own (its card carries `type`)
      // slugifies to the same — so match owned cards to tint workflow casts amber, skills
      // violet. Default skill (violet) when unknown (bundled skills, not-yet-loaded cards).
      const slugify = (s: string) =>
        (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
      const card = state.marketOwnedCards.find((c) => c.name === ev.name || slugify(c.name) === ev.name);
      const kind: "skill" | "workflow" = card?.type === "workflow" ? "workflow" : "skill";
      // Stack distinct casts (workflow + the skills it chains); cap so the strip stays short.
      const rest = state.firingSkills.filter((f) => f.name !== ev.name);
      return { ...state, firingSkills: [...rest, { name: ev.name, kind }].slice(-5) };
    }
    case "publishResult":
      return { ...state, publishResult: ev, publishProgress: null };
    case "publishProgress":
      return { ...state, publishProgress: { phase: ev.phase, signed: ev.signed, percent: ev.percent, kind: ev.kind }, publishKind: ev.kind };
    case "postNoteResult":
      return { ...state, toast: ev.ok ? "Comment posted." : `Comment failed: ${ev.error ?? "unknown"}` };
    case "workRepoRegistered":
      // No toast here: the register modal owns the success/failure messaging (step view +
      // celebration), so a global toast would be a second, redundant alert.
      return {
        ...state,
        workRepoResult: { ok: ev.ok, count: ev.count, repo: ev.repo, error: ev.error, at: Date.now() },
      };
    case "agents":
      return { ...state, agents: ev.agents as Reputation[], agentsLoading: false };
    case "agentProfile":
      return { ...state, agentProfile: ev.profile, agentProfileLoading: false };
    case "buyAllResult":
      return {
        ...state,
        toast: ev.bought > 0
          ? `Bought ${ev.bought} skill${ev.bought === 1 ? "" : "s"}${ev.failed > 0 ? ` (${ev.failed} failed)` : ""}.`
          : `Buy failed: ${ev.error ?? "nothing purchased"}`,
        // Fire the same purchase card as a single buy when anything landed.
        buyCelebrate: ev.bought > 0 ? true : state.buyCelebrate,
        buyCelebrateLabel: ev.bought > 0 ? `${ev.bought} skill${ev.bought === 1 ? "" : "s"}` : state.buyCelebrateLabel,
      };
    case "agentNoteResult":
      return { ...state, toast: ev.ok ? "Note posted." : `Note failed: ${ev.error ?? "unknown"}` };
    case "notes":
      return state;
    case "githubStatus":
      return { ...state, githubStatus: { hasToken: ev.hasToken, masked: ev.masked } };
    case "__loadingAgents":
      return { ...state, agentsLoading: true };
    case "__loadingAgentProfile":
      // Optimistic: clear the old profile and flag loading so the screen shows a skeleton the
      // instant a card is tapped (the result lands a round-trip later). Cleared by "agentProfile".
      return { ...state, agentProfileLoading: true, agentProfile: null };
    case "__clearAgentProfile":
      return { ...state, agentProfile: null, agentProfileLoading: false };
    case "__changeMode":
      return {
        ...state,
        modeByCli: {
          ...state.modeByCli,
          [state.cli]: ev.mode,
        },
      };
    case "__clearFiringSkill":
      return { ...state, firingSkills: [] };
    case "__clearCelebrate":
      return { ...state, buyCelebrate: false, buyCelebrateLabel: null };
    default:
      return state;
  }
}

interface Store {
  state: State;
  send: (msg: ClientMessage) => void;
  // local-only helpers (don't round-trip through core)
  startTyping: () => void;
  resolveApproval: (id: string) => void;
  clearToast: () => void;
  selectEngine: (cli: Cli) => void;
  finishStorage: () => void;
  savePlan: (text: string) => void;
  openMarket: () => void;
  openMarketAgents: () => void;
  openOwnedSkills: () => void;
  closeMarket: () => void;
  setMarketTab: (tab: "skill" | "workflow") => void;
  setMarketQuery: (q: string) => void;
  marketSearching: () => void;
  clearMarketDetail: () => void;
  clearPublishResult: () => void;
  queueCount: number;
  loadingAgents: () => void;
  clearAgentProfile: () => void;
  clearFiringSkill: () => void;
  clearCelebrate: () => void;
  // Current SSE client id — native (Android) notification actions POST to /rpc with it.
  getClientId: () => string | null;
  // Show a transient toast locally (e.g. the foreground-only turn-off notice, #53).
  notify: (text: string) => void;
  markCompacting: () => void;
}

const StoreContext = createContext<Store | null>(null);

async function handleSignTransaction(t: Transport, id: string, txBase64: string): Promise<void> {
  try {
    let signedTx: string;
    if (isAndroidWallet()) {
      signedTx = await signAndroidTransaction(txBase64);
    } else {
      const provider = (window as unknown as {
        solana?: { signTransaction?: Parameters<typeof providerSignBase64>[1] };
      }).solana;
      if (!provider?.signTransaction) throw new Error("No Solana wallet available to sign.");
      signedTx = await providerSignBase64(txBase64, provider.signTransaction.bind(provider));
    }
    await t.post({ type: "signTransactionResult", id, signedTx });
  } catch (e) {
    await t.post({ type: "signTransactionResult", id, error: (e as Error)?.message || "Signing failed." });
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, raw] = useReducer(reducer, initialState);
  const transportRef = useRef<Transport | null>(null);
  const msgQueue = useRef<{ text: string; images?: ImageInput[] }[]>([]);
  const busyRef = useRef(false);
  const perfLoadStart = useRef<number | null>(null); // perf diag: session-open timing

  useEffect(() => {
    const t = new Transport();
    transportRef.current = t;
    const off = t.onEvent((msg) => {
      if (msg.type === "signTransaction") {
        void handleSignTransaction(t, msg.id, msg.tx);
        return;
      }
      // perf diag: measure session-open from the server's `loading` to the painted
      // history. dispatch = reducer time for the message burst; paint = after the browser
      // actually composites (double rAF). Compare against the server [perf] loadLatest to
      // localize the cost (storage vs client render). Logged to chromium console → logcat.
      if (msg.type === "loading") perfLoadStart.current = performance.now();
      raw(msg);
      if (msg.type === "page" && perfLoadStart.current != null) {
        const start = perfLoadStart.current;
        perfLoadStart.current = null;
        const dispatched = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            console.log(
              `[perf-client] session paint: dispatch=${Math.round(dispatched - start)}ms paint=${Math.round(performance.now() - start)}ms`,
            ),
          ),
        );
      }
    });
    t.open();
    void t.post({ type: "ready" });
    return () => {
      off();
      t.close();
    };
  }, []);

  // Keep busyRef in sync so send() (stable closure) can read current busy state.
  useEffect(() => { busyRef.current = state.typing; }, [state.typing]);

  // Flush queued messages when agent becomes free.
  useEffect(() => {
    if (!state.typing && msgQueue.current.length > 0) {
      const next = msgQueue.current.shift()!;
      raw({ type: "__dequeueMsg" });
      raw({ type: "__typing" });
      void transportRef.current?.post({ type: "send", text: next.text, images: next.images });
    }
  }, [state.typing]);

  // When onboarding completes (phase enters "chat"), the first SSE stream is still bound
  // to the server's ONBOARDING handler — which ignores chat messages. Reopen the stream so
  // the server, now that a runtime exists, attaches the CHAT dispatcher to a fresh client.
  // Without this a React SPA (no navigation) would keep the onboarding client and silently
  // drop every `send`. Guard on the transition so we reopen exactly once.
  const wasChat = useRef(false);
  useEffect(() => {
    if (state.phase === "chat" && !wasChat.current) {
      wasChat.current = true;
      transportRef.current?.reopen();
      // reopen() spins up a FRESH client that the server binds to attachChat (runtime now
      // exists). That handler only pushes sessions + storage on "ready" — and the initial
      // ready (sent at mount) went to the now-discarded onboarding client. So re-send it,
      // or the chat lands with no session list and a stale "local only" storage pill.
      void transportRef.current?.post({ type: "ready" });
      void transportRef.current?.post({ type: "platform", cli: state.cli });
    } else if (state.phase !== "chat") {
      wasChat.current = false;
    }
  }, [state.phase, state.cli]);

  const store = useMemo<Store>(() => {
    const selectEngine = (cli: Cli) => {
      const status = state.cliReport?.[cli];
      raw({ type: "__selectEngine", cli });
      if (!state.cliReport) {
        void transportRef.current?.post({ type: "getCliStatus" });
        return;
      }
      if (status === "ok" && state.phase === "chat") {
        void transportRef.current?.post({ type: "platform", cli });
      }
    };
    const send = (msg: ClientMessage) => {
      if (msg.type === "platform") {
        selectEngine(msg.cli);
        return;
      }
      if (msg.type === "send") {
        if (!state.cliReport || state.cliReport[state.cli] !== "ok") {
          selectEngine(state.cli);
          return;
        }
        if (busyRef.current) {
          // Agent busy — show pending bubble immediately, flush when turn ends.
          msgQueue.current.push({ text: msg.text, images: msg.images });
          raw({ type: "__queueMsg", text: msg.text });
          return;
        }
        raw({ type: "__typing" });
      }
      // Tapping a chat: switch the UI to it immediately (title + loading) instead of
      // waiting for the server's load round-trip, which felt like "nothing happened".
      if (msg.type === "open") {
        raw({ type: "__openingSession", sessionId: msg.sessionId });
      }
      // New chat should feel instant. The server still owns the canonical session, but
      // clearing locally avoids a dead tap while mobile storage/session repaint catches up.
      if (msg.type === "new") {
        raw({ type: "__newChat" });
      }
      // Inject inline model-switch separator into chat log.
      if (msg.type === "model" && msg.model) {
        raw({ type: "__modelChange", model: msg.model });
      }
      if (msg.type === "mode" && typeof msg.mode === "string") {
        raw({ type: "__changeMode", mode: msg.mode });
      }
      // Opening an agent's profile should feel instant: show a skeleton immediately instead of a
      // dead tap while the server load round-trips. Only when NAVIGATING to a different agent (or
      // none open) — a same-wallet refresh (e.g. after registering a repo) keeps the page on screen.
      if (msg.type === "getAgentProfile" && state.agentProfile?.wallet !== msg.wallet) {
        raw({ type: "__loadingAgentProfile" });
      }
      void transportRef.current?.post(msg);
    };
    return {
      state,
      send,
      startTyping: () => raw({ type: "__typing" }),
      // Drop an answered approval from the dock immediately; core won't re-send it.
      resolveApproval: (id) => raw({ type: "__removeApproval", id }),
      clearToast: () => raw({ type: "__clearToast" }),
      // Activate the chosen engine; routing (login gate / chat) is decided in the reducer.
      selectEngine,
      finishStorage: () => raw({ type: "__finishStorage" }),
      savePlan: (text) => raw({ type: "__savePlan", text }),
      openMarket: () => raw({ type: "__openMarket" }),
      openMarketAgents: () => raw({ type: "__openMarket", initialView: "agents" }),
      openOwnedSkills: () => raw({ type: "__openMarket", initialView: "owned" }),
      closeMarket: () => raw({ type: "__closeMarket" }),
      setMarketTab: (tab) => raw({ type: "__setMarketTab", tab }),
      setMarketQuery: (query) => raw({ type: "__setMarketQuery", query }),
      marketSearching: () => raw({ type: "__marketSearching" }),
      clearMarketDetail: () => raw({ type: "__clearMarketDetail" }),
      clearPublishResult: () => raw({ type: "__clearPublishResult" }),
      queueCount: state.queuePending,
      loadingAgents: () => raw({ type: "__loadingAgents" }),
      clearAgentProfile: () => raw({ type: "__clearAgentProfile" }),
      clearFiringSkill: () => raw({ type: "__clearFiringSkill" }),
      clearCelebrate: () => raw({ type: "__clearCelebrate" }),
      getClientId: () => transportRef.current?.getClientId() ?? null,
      notify: (text) => raw({ type: "__setToast", text }),
      markCompacting: () => raw({ type: "__compactStart" }),
    };
  }, [state]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used within StoreProvider");
  return s;
}
