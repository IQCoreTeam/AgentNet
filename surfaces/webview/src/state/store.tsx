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
export interface State {
  phase: "connecting" | "onboarding" | "chat";
  walletAddress: string | null;
  cli: Cli;
  log: ChatMessage[];
  sessions: SessionMeta[];
  activeSessionId?: string;
  approvals: ApprovalRequest[];
  storage: { info: unknown; options: unknown } | null;
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
  log: [],
  sessions: [],
  approvals: [],
  storage: null,
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
// from the dock, dismissing a toast).
type LocalAction =
  | { type: "__typing" }
  | { type: "__removeApproval"; id: string }
  | { type: "__clearToast" };
type Action = ServerMessage | LocalAction;

function reducer(state: State, ev: Action): State {
  switch (ev.type) {
    case "__typing":
      return { ...state, typing: true };
    case "__removeApproval":
      return { ...state, approvals: state.approvals.filter((a) => a.id !== ev.id) };
    case "__clearToast":
      return { ...state, toast: null };
    case "init":
      // Onboarding handshake: no runtime yet → show ConnectWallet.
      return { ...state, phase: "onboarding" };
    case "walletConnected":
      // Wallet is in. The dispatcher (chat) attaches on the next /events open; until its
      // `clear`/`sessions` arrive we're in chat phase with an empty log.
      return { ...state, phase: "chat", walletAddress: ev.address };
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
      return { ...state, storage: { info: ev.info, options: ev.options } };
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
    };
  }, [state]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used within StoreProvider");
  return s;
}
