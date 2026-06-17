import { useCallback, useEffect, useRef, useState } from "react";
import { spawn } from "node:child_process";
import type {
  AgentRuntime,
  SessionHandle,
  ChatMessage,
  SessionMeta,
} from "@iqlabs-official/agent-sdk/runtime/contract";
import type { ApprovalChannel } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import { savePrefs, type EffortLevel } from "../prefs.js";

export type Engine = "claude" | "codex";
export type { EffortLevel };

// The REPL brain. Mirrors the vscode openChat() loop (extension.ts) but for a single
// active chat: lazy-spawn a handle on first send, append onMessage to the transcript,
// stop the spinner on turnEnd, and carry the session across engine switches (cross-CLI
// resume — the runtime re-injects history into the new cli on the next send).
export function useChat(
  runtime: AgentRuntime,
  opts: { cli: Engine; model?: string; effort?: EffortLevel; cwd: string; resume?: string; approval?: ApprovalChannel },
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [cli, setCli] = useState<Engine>(opts.cli);
  const [model, setModel] = useState<string | undefined>(opts.model);
  const [effort, setEffort] = useState<EffortLevel | undefined>(opts.effort);
  const [pendingId, setPendingId] = useState<string | undefined>(opts.resume);
  const [elapsed, setElapsed] = useState<number | undefined>(undefined);
  const [contextTokens, setContextTokens] = useState<number | undefined>(undefined);
  // scrollback pagination (older pages) + a Static-reset epoch (bumped on any wholesale
  // transcript change so the <Static> history re-renders instead of mis-appending).
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [firingSkill, setFiringSkill] = useState<string | null>(null);

  useEffect(() => {
    if (firingSkill) {
      const t = setTimeout(() => setFiringSkill(null), 1400);
      return () => clearTimeout(t);
    }
  }, [firingSkill]);

  const handle = useRef<SessionHandle | null>(null);
  // keep latest cli/model in refs so ensureHandle (created once) reads current values.
  const cliRef = useRef(cli);
  const modelRef = useRef(model);
  const effortRef = useRef(effort);
  const pendingRef = useRef(pendingId);
  cliRef.current = cli;
  modelRef.current = model;
  effortRef.current = effort;
  pendingRef.current = pendingId;

  const refreshSessions = useCallback(async () => {
    setSessions(await runtime.listSessions());
  }, [runtime]);

  // turn timer: tick elapsed while busy.
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [busy]);

  // initial: load resumed history (newest page + cursor for older) + session list.
  useEffect(() => {
    void refreshSessions();
    if (opts.resume) {
      void runtime.loadSession(opts.resume).then((p) => {
        setMessages(p.messages);
        setHasMore(p.hasMore);
        setCursor(p.cursor);
        setEpoch((e) => e + 1);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load the page BEFORE the current oldest (scroll-back). Prepends + resets Static.
  const loadOlder = useCallback(async () => {
    if (!hasMore || cursor === null || !pendingRef.current) return;
    const p = await runtime.loadMore(pendingRef.current, cursor);
    setMessages((prev) => [...p.messages, ...prev]);
    setHasMore(p.hasMore);
    setCursor(p.cursor);
    setEpoch((e) => e + 1);
  }, [hasMore, cursor, runtime]);

  const wire = useCallback(
    (h: SessionHandle) => {
      h.onMessage((m) =>
        setMessages((prev) => {
          // partial assistant messages carry the FULL text-so-far (the core accumulates
          // claude deltas; codex sends snapshots) — so we REPLACE the live line, not append.
          // The final partial:false message replaces it once more with the settled text.
          const last = prev[prev.length - 1];
          const streamingLast = last && last.role === "assistant" && last.partial;
          if (m.role === "assistant" && (m.partial || streamingLast)) {
            if (streamingLast) return [...prev.slice(0, -1), m];
            return [...prev, m];
          }
          return [...prev, m];
        }),
      );
      h.onUsage((n) => setContextTokens(n));
      h.onSkill((name) => setFiringSkill(name));
      h.onTurnEnd(() => {
        // a fresh session reveals its canonical id now — adopt it so resume/switch work.
        const id = pendingRef.current || h.sessionId;
        if (!pendingRef.current && h.sessionId) setPendingId(h.sessionId);
        setBusy(false);
        void refreshSessions();
        // remember where we were so `--continue` / next launch can resume it.
        if (id) void savePrefs({ lastSessionId: id, lastCli: cliRef.current });
      });
    },
    [refreshSessions],
  );

  const ensureHandle = useCallback(async (): Promise<SessionHandle> => {
    if (handle.current) return handle.current;
    const h = await runtime.startSession({
      cli: cliRef.current,
      model: modelRef.current,
      effort: effortRef.current,
      cwd: opts.cwd,
      sessionId: pendingRef.current,
      approval: opts.approval,
      stream: true, // CLI streams token deltas; vscode (no stream) keeps whole-turn
    });
    handle.current = h;
    wire(h);
    return h;
  }, [runtime, opts.cwd, opts.approval, wire]);

  const send = useCallback(
    async (text: string, images?: import("@iqlabs-official/agent-sdk/runtime/contract").ImageInput[]) => {
      setBusy(true);
      const h = await ensureHandle();
      h.send(text, images && images.length ? images : undefined);
    },
    [ensureHandle],
  );

  // stop + drop the live handle (next send respawns). Used on engine/model/session change.
  const dropHandle = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
  }, []);

  // cancel a running turn (Esc): stop the engine and unblock the UI immediately.
  const interrupt = useCallback(() => {
    if (!handle.current) return;
    dropHandle();
    setBusy(false);
  }, [dropHandle]);

  const switchEngine = useCallback(
    (next: Engine) => {
      if (next === cliRef.current) return;
      dropHandle();
      setCli(next);
      setContextTokens(undefined);
      void savePrefs({ lastCli: next });
    },
    [dropHandle],
  );

  const changeModel = useCallback(
    (m?: string) => {
      dropHandle();
      setModel(m);
      setContextTokens(undefined);
      void savePrefs({ lastModel: m });
    },
    [dropHandle],
  );

  const changeEffort = useCallback(
    (e?: EffortLevel) => {
      dropHandle();
      setEffort(e);
      void savePrefs({ lastEffort: e });
    },
    [dropHandle],
  );

  const openSession = useCallback(
    async (id: string) => {
      dropHandle();
      setPendingId(id);
      setContextTokens(undefined); // reset bar — new session's usage unknown until first turn
      const p = await runtime.loadSession(id);
      setMessages(p.messages);
      setHasMore(p.hasMore);
      setCursor(p.cursor);
      setEpoch((e) => e + 1);
    },
    [dropHandle, runtime],
  );

  const newSession = useCallback(() => {
    dropHandle();
    setPendingId(undefined);
    setMessages([]);
    setContextTokens(undefined);
    setHasMore(false);
    setCursor(null);
    setEpoch((e) => e + 1);
  }, [dropHandle]);

  // `!cmd` quick shell: run a command locally in the session cwd and show it as a tool
  // card. NOT sent to the engine and NOT persisted — a convenience, like a scratch shell.
  const runBash = useCallback(
    (cmd: string) => {
      setMessages((prev) => [...prev, { role: "user", text: "!" + cmd, ts: Date.now() }]);
      let out = "";
      try {
        const p = spawn(cmd, { shell: true, cwd: opts.cwd });
        p.stdout?.on("data", (d) => (out += d.toString()));
        p.stderr?.on("data", (d) => (out += d.toString()));
        p.on("error", (e) => (out += String(e)));
        p.on("close", (code) =>
          setMessages((prev) => [
            ...prev,
            { role: "tool", text: cmd, ts: Date.now(), tool: { name: "Bash", command: cmd, output: out.slice(0, 4000), exitCode: code ?? 0 } },
          ]),
        );
      } catch (e) {
        setMessages((prev) => [...prev, { role: "tool", text: cmd, ts: Date.now(), tool: { name: "Bash", command: cmd, output: String(e), exitCode: 1 } }]);
      }
    },
    [opts.cwd],
  );

  // clear the on-screen transcript WITHOUT ending the session (the log on disk is kept;
  // /more or a reload can bring it back).
  const clearView = useCallback(() => {
    setMessages([]);
    setHasMore(false);
    setEpoch((e) => e + 1);
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await runtime.deleteSession(id);
      if (id === pendingRef.current) newSession();
      await refreshSessions();
    },
    [runtime, newSession, refreshSessions],
  );

  // cleanup on unmount
  useEffect(() => () => dropHandle(), [dropHandle]);

  return {
    messages,
    sessions,
    busy,
    cli,
    model,
    effort,
    pendingId,
    elapsed,
    contextTokens,
    hasMore,
    epoch,
    send,
    interrupt,
    loadOlder,
    clearView,
    runBash,
    switchEngine,
    changeModel,
    changeEffort,
    openSession,
    newSession,
    deleteSession,
    refreshSessions,
    firingSkill,
  };
}
