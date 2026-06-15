// The UI state, driven entirely by server->UI events. The dispatcher (packages/core) is
// the source of truth; this reducer just projects its event stream into render state.
// One reducer, one action per ServerMessage type - no multi-harness abstraction (we run
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
import type {
  ApprovalRequest,
  ChatMessage,
  Cli,
  ClientMessage,
  ServerMessage,
  SessionMeta,
} from "../transport/protocol";

// A rendered log entry. We keep messages as-is and stream into the last assistant/
// thinking bubble when `partial` is set, matching the HTML webview's bubble model.
export type EngineStatus = "ok" | "no-login" | "missing";

export interface State {
  phase:
    | "connecting"
    | "welcome"
    | "onboarding"
    | "storageSelect"
    | "engineSelect"
    | "claudeAuth"
    | "codexAuth"
    | "chat";
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
  approvals: [],
  storage: null,
  googleCredsError: null,
  cloudSync: null,
  typing: false,
  loading: false,
  hasMore: false,
  cursor: 0,
  toast: null,
};

// Append a streamed message: if the incoming partial continues the same role/cli as the
// tail bubble, merge text into it; otherwise start a new bubble. A non-partial message is
// a complete bubble (or a tool/summary/user entry) pushed as-is.
function appendMessage(log: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const tail = log[log.length - 1];
  const streamingInto =
    msg.partial &&
    tail &&
    tail.partial &&
    tail.role === msg.role &&
    tail.cli === msg.cli &&
    (msg.role === "assistant" || msg.role === "thinking");
  if (streamingInto) {
    const merged: ChatMessage = { ...tail, ...msg, text: tail.text + msg.text };
    return [...log.slice(0, -1), merged];
  }
  return [...log, msg];
}

// Actions = server events (projected verbatim) + a few local-only UI effects the
// dispatcher doesn't round-trip (optimistic typing dots, removing an answered approval
// from the dock, dismissing a toast, advancing the welcome step, picking an engine).
type LocalAction =
  | { type: "__typing" }
  | { type: "__removeApproval"; id: string }
  | { type: "__clearToast" }
  | { type: "__welcomeContinue" }
  | { type: "__selectEngine"; cli: Cli }
  | { type: "__finishStorage" };
type Action = ServerMessage | LocalAction;

function reducer(state: State, ev: Action): State {
  switch (ev.type) {
    case "__typing":
      return { ...state, typing: true };
    case "__removeApproval":
      return { ...state, approvals: state.approvals.filter((a) => a.id !== ev.id) };
    case "__clearToast":
      return { ...state, toast: null };
    case "__welcomeContinue":
      // Leave the compact welcome and go to wallet connect.
      return { ...state, phase: "onboarding" };
    case "__selectEngine": {
      // Activate the chosen engine. "missing" (CLI not installed) and the not-yet-known
      // state are handled in the picker UI with install guidance - we never route into a
      // broken runtime or dead-end on a toast here.
      const status = ev.cli === "claude" ? state.cliReport?.claude : state.cliReport?.codex;
      if (status == null || status === "missing") return state;
      if (status === "no-login") {
        return { ...state, cli: ev.cli, phase: ev.cli === "claude" ? "claudeAuth" : "codexAuth" };
      }
      return { ...state, cli: ev.cli, phase: "chat" };
    }
    case "init":
      // First run / no runtime yet -> show the compact welcome, then wallet connect.
      return { ...state, phase: "welcome" };
    case "walletConnected":
      // Storage is non-blocking. First-time users default to local-only storage and go
      // straight to AI connection; the cloud mirror is offered later (Settings / nudge),
      // never as a gate before the first chat. So we skip the storage picker entirely.
      return { ...state, walletAddress: ev.address, phase: "engineSelect" };
    case "cliStatus":
      // After wallet: don't force claude. Record both engines' status and show the engine
      // picker so the user chooses which one to activate. The chosen engine then runs its
      // own gate (claude -> login if needed; codex -> device-auth) via __selectEngine.
      // This event is also re-emitted in response to `checkCliStatus` (the picker's
      // "recheck" after the user installs a CLI), so the pills refresh in place.
      return {
        ...state,
        cliReport: { claude: ev.claude, codex: ev.codex },
      };
    case "__finishStorage":
      return { ...state, phase: "engineSelect" };
    case "googleLoginUrl":
      return { ...state, googleLoginUrl: ev.url, googleLoginError: null };
    case "googleLoginStatus":
      // Storage is now optional and usually configured from Settings (inside chat). Only
      // advance the onboarding phase if we were on the (no-longer-default) storage step;
      // otherwise just clear the login UI and stay where we are.
      return ev.status === "done"
        ? {
            ...state,
            googleLoginUrl: null,
            googleLoginError: null,
            phase: state.phase === "storageSelect" ? "engineSelect" : state.phase,
          }
        : { ...state, googleLoginUrl: null, googleLoginError: ev.error ?? "Login failed." };
    case "openUrl":
      window.open(ev.url, "_blank");
      return state;
    case "claudeLoginUrl":
      return { ...state, claudeLoginUrl: ev.url, claudeLoginError: null };
    case "claudeLoginStatus":
      return ev.status === "done"
        ? { ...state, phase: "chat", claudeLoginUrl: null, claudeLoginError: null }
        : { ...state, claudeLoginUrl: null, claudeLoginError: ev.error ?? "Login failed." };
    case "codexLoginChallenge":
      return { ...state, codexLoginUrl: ev.url, codexLoginCode: ev.code, codexLoginError: null };
    case "codexLoginStatus":
      return ev.status === "done"
        ? { ...state, phase: "chat", codexLoginUrl: null, codexLoginCode: null, codexLoginError: null }
        : { ...state, codexLoginUrl: null, codexLoginCode: null, codexLoginError: ev.error ?? "Login failed." };
    case "clear":
      return { ...state, log: [], approvals: [], typing: false, loading: false };
    case "message":
      return { ...state, log: appendMessage(state.log, ev.msg) };
    case "turnEnd":
      return { ...state, typing: false };
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
      return { ...state, phase: "chat", sessions: ev.list, activeSessionId: ev.activeId };
    case "loading":
      return { ...state, loading: true };
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
    case "toast":
      return { ...state, toast: ev.text };
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
  welcomeContinue: () => void;
  selectEngine: (cli: Cli) => void;
  finishStorage: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, raw] = useReducer(reducer, initialState);
  const transportRef = useRef<Transport | null>(null);

  useEffect(() => {
    const t = new Transport();
    transportRef.current = t;
    const off = t.onEvent((msg) => raw(msg));
    t.open();
    void t.post({ type: "ready" });
    return () => {
      off();
      t.close();
    };
  }, []);

  // When onboarding completes (phase enters "chat"), the first SSE stream is still bound
  // to the server's ONBOARDING handler - which ignores chat messages. Reopen the stream so
  // the server, now that a runtime exists, attaches the CHAT dispatcher to a fresh client.
  // Without this a React SPA (no navigation) would keep the onboarding client and silently
  // drop every `send`. Guard on the transition so we reopen exactly once.
  const wasChat = useRef(false);
  useEffect(() => {
    if (state.phase === "chat" && !wasChat.current) {
      wasChat.current = true;
      transportRef.current?.reopen();
      // reopen() spins up a FRESH client that the server binds to attachChat (runtime now
      // exists). That handler only pushes sessions + storage on "ready" - and the initial
      // ready (sent at mount) went to the now-discarded onboarding client. So re-send it,
      // or the chat lands with no session list and a stale "local only" storage pill.
      void transportRef.current?.post({ type: "ready" });
    } else if (state.phase !== "chat") {
      wasChat.current = false;
    }
  }, [state.phase]);

  const store = useMemo<Store>(() => {
    const send = (msg: ClientMessage) => {
      // Optimistically show typing dots on send; core's turnEnd clears them.
      if (msg.type === "send") raw({ type: "__typing" });
      void transportRef.current?.post(msg);
    };
    return {
      state,
      send,
      startTyping: () => raw({ type: "__typing" }),
      // Drop an answered approval from the dock immediately; core won't re-send it.
      resolveApproval: (id) => raw({ type: "__removeApproval", id }),
      clearToast: () => raw({ type: "__clearToast" }),
      // Leave the welcome step -> wallet connect.
      welcomeContinue: () => raw({ type: "__welcomeContinue" }),
      // Activate the chosen engine; routing (login gate / chat) is decided in the reducer.
      selectEngine: (cli) => raw({ type: "__selectEngine", cli }),
      finishStorage: () => raw({ type: "__finishStorage" }),
    };
  }, [state]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used within StoreProvider");
  return s;
}
