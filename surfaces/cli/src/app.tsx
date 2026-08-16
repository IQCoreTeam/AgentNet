import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentRuntime, SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { autoApprove, type StorageConfig, type CliReport } from "@iqlabs-official/agent-sdk";
import type { CloudStatus } from "@iqlabs-official/agent-sdk/account/storage/mirror";
import { InkApprovalChannel } from "./InkApprovalChannel.js";
import { Banner } from "./components/Banner.js";
import { BootChecklist, type BootStep } from "./components/BootChecklist.js";
import { Onboarding } from "./views/Onboarding.js";
import { LoginGate } from "./views/LoginGate.js";
import { Chat } from "./views/Chat.js";
import { colors } from "./theme.js";
import {
  loadWallet,
  detectCli,
  isInitialized,
  buildRuntime,
  chooseStorage,
} from "./bootstrap.js";
import { readPrefs, savePrefs, type Prefs } from "./prefs.js";

type Phase = "boot" | "onboard" | "login" | "chat" | "error";

export interface AppOptions {
  cli?: "claude" | "codex";
  cwd?: string;
  keypair?: string;
  model?: string;
  effort?: import("./prefs.js").EffortLevel;
  resume?: string;
  continue?: boolean; // resume the most recent session (prefs.lastSessionId)
  yolo?: boolean; // auto-approve all tool use (no prompts)
}

// Root router. Sequences the same boot the vscode surface does (wallet → detect → connect)
// but renders it as a live checklist, then lands on onboarding (first run) or chat.
export function App({ options }: { options: AppOptions }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [steps, setSteps] = useState<BootStep[]>([
    { tag: "wallet", label: "loading wallet", status: "pending" },
    { tag: "claude", label: "checking claude", status: "pending" },
    { tag: "codex", label: "checking codex", status: "pending" },
    { tag: "storage", label: "restoring storage", status: "pending" },
  ]);
  const [address, setAddress] = useState("");
  const [report, setReport] = useState<CliReport>({ claude: "missing", codex: "missing" });
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  // the connected wallet, kept so the chat view can build the skill-market env from it.
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof loadWallet>>["wallet"] | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({});
  // tool-approval seam: --yolo skips the UI (auto-allow); otherwise prompts route here.
  const approval = React.useRef<InkApprovalChannel | null>(options.yolo ? null : new InkApprovalChannel());
  // reported by mirrorStorage after each cloud write attempt — drives the StatusLine
  // sync chip so a dead/offline cloud is visible instead of silently drifting.
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null);
  // the saved meta of the session being resumed (looked up in go() before the chat
  // renders), so the session comes back wearing ITS OWN model/effort.
  const [resumed, setResumed] = useState<SessionMeta | null>(null);

  const { exit } = useApp();
  // Ctrl+C during boot/onboarding/error — nothing's running yet, so quit straight away.
  // Ink's built-in exitOnCtrlC is off (see index.tsx); in the chat phase Chat owns Ctrl+C
  // (interrupt-then-quit), so this stays out of its way.
  useInput((input, key) => {
    if (key.ctrl && input === "c") exit();
  }, { isActive: phase !== "chat" });

  const set = (i: number, patch: Partial<BootStep>) =>
    setSteps((s) => s.map((step, j) => (j === i ? { ...step, ...patch } : step)));

  // connect wallet → runtime, then enter chat. Reused after onboarding too. `freshCloud`
  // is set when onboarding just connected a cloud backend for the FIRST time on this
  // device — an explicit connect, so (same as a mid-session reconnect) it gets a one-shot
  // backfill of anything already local (e.g. sessions from a prior local-only run).
  async function go(addr: string, w: Awaited<ReturnType<typeof loadWallet>>["wallet"], freshCloud?: boolean) {
    set(3, { status: "pending", label: "connecting storage" });
    const rt = await buildRuntime(w, approval.current ?? autoApprove(), setCloudStatus);
    setRuntime(rt);
    setWallet(w);
    // Resuming? Look up that session's saved meta BEFORE entering chat, so the first
    // chat render already seeds useChat with the session's own model/effort (issue 167:
    // a session created with --model haiku resumed showing and running the default
    // model). Prefs are re-read here because the boot effect's setPrefs(savedPrefs)
    // has not committed when go() runs in the same closure.
    const resumeId = options.resume ?? (options.continue ? (await readPrefs()).lastSessionId : undefined);
    if (resumeId) {
      const meta = (await rt.listSessions().catch(() => [] as SessionMeta[])).find((s) => s.sessionId === resumeId);
      if (meta) setResumed(meta);
    }
    set(3, { status: "ok", label: "storage ready", detail: "READY" });
    // wipe the boot banner/checklist from the scrollback so the welcome panel lands on a
    // clean screen (Ink leaves prior static output in the terminal history otherwise),
    // then pad down to the bottom edge. Chat's frame is only as tall as its live content,
    // so this is what puts the composer on the bottom row of an empty session; once the
    // transcript grows it fills the screen and holds the frame there on its own.
    const padRows = Math.max(0, (process.stdout.rows || 24) - 1);
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H" + "\n".repeat(padRows));
    setPhase("chat");
    if (freshCloud) {
      void rt.syncCloud().catch(() => { /* best-effort; a later write or reconnect re-syncs */ });
    }
  }

  // Re-bind the runtime to whatever storage config.json now holds (called after Chat
  // writes a new storage choice mid-session — connect, reconnect, or disconnect). Without
  // this the already-built runtime keeps mirroring the OLD cloud/local choice forever,
  // since it was bound once at boot and storage config changes don't self-apply.
  async function rebuildRuntime(): Promise<AgentRuntime> {
    const rt = await buildRuntime(wallet!, approval.current ?? autoApprove(), setCloudStatus);
    setRuntime(rt);
    return rt;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ wallet, address: addr }, savedPrefs] = await Promise.all([
          loadWallet(options.keypair),
          readPrefs(),
        ]);
        if (!alive) return;
        setAddress(addr);
        setPrefs(savedPrefs);
        set(0, { status: "ok", label: "wallet", detail: `${addr.slice(0, 6)}…${addr.slice(-4)}` });

        const rep = await detectCli();
        if (!alive) return;
        setReport(rep);
        const engineDetail = (s: CliReport["claude"]) =>
          s === "ok" ? "OK" : s === "no-login" ? "NEEDS LOGIN" : "NOT INSTALLED";
        set(1, { status: rep.claude === "ok" ? "ok" : "fail", label: `claude ${rep.claude}`, detail: engineDetail(rep.claude) });
        set(2, { status: rep.codex === "ok" ? "ok" : "fail", label: `codex ${rep.codex}`, detail: engineDetail(rep.codex) });

        // onboard only on a TRUE first run: neither a finished-setup marker nor a
        // configured cloud. (Local-only writes no storage config, so the marker is what
        // stops the every-launch onboarding loop.)
        if (savedPrefs.onboarded || (await isInitialized())) {
          if (!alive) return;
          // returning user: if the engine chat would open with isn't signed in, fall
          // back to the OTHER engine when it is (start with what works — no gate), and
          // only gate on the login screen when nothing is usable. An explicit --cli
          // flag skips the silent fallback: the user asked for that engine, so gate.
          const eff = options.cli ?? savedPrefs.lastCli ?? "claude";
          const other: "claude" | "codex" = eff === "claude" ? "codex" : "claude";
          if (rep[eff] === "ok") {
            await go(addr, wallet);
          } else if (!options.cli && rep[other] === "ok") {
            setPrefs((p) => ({ ...p, lastCli: other }));
            void savePrefs({ lastCli: other });
            await go(addr, wallet);
          } else {
            loginDone.current = (rep2, logged) => {
              setReport(rep2);
              if (logged) {
                setPrefs((p) => ({ ...p, lastCli: logged }));
                void savePrefs({ lastCli: logged });
              }
              void go(addr, wallet);
            };
            setLoginPrefer(rep[eff] === "missing" && rep[other] !== "missing" ? other : eff);
            setPhase("login");
          }
        } else {
          if (!alive) return;
          set(3, { status: "ok", label: "storage: pick on next screen", detail: "PICK NEXT" });
          setPhase("onboard");
          onboardFinish.current = async (engine: "claude" | "codex", cfg?: StorageConfig) => {
            if (cfg) await chooseStorage(cfg);
            await savePrefs({ onboarded: true, lastCli: engine });
            await go(addr, wallet, !!cfg && cfg.kind !== "local");
          };
        }
      } catch (e) {
        if (!alive) return;
        setErrMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // set by the boot effect so Onboarding can finish with the live wallet in scope.
  const onboardFinish = React.useRef<(engine: "claude" | "codex", cfg?: StorageConfig) => void>(() => {});
  // login-gate continuation + which engine its picker should preselect.
  const loginDone = React.useRef<(rep: CliReport, logged?: "claude" | "codex") => void>(() => {});
  const [loginPrefer, setLoginPrefer] = useState<"claude" | "codex">("claude");

  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={colors.err}>couldn't start: {errMsg}</Text>
      </Box>
    );
  }

  if (phase === "boot") {
    return (
      <Box flexDirection="column">
        <Banner />
        <BootChecklist steps={steps} />
      </Box>
    );
  }

  if (phase === "onboard") {
    return <Onboarding report={report} address={address} onDone={(engine, cfg) => onboardFinish.current(engine, cfg)} />;
  }

  if (phase === "login") {
    return <LoginGate report={report} prefer={loginPrefer} onDone={(rep, logged) => loginDone.current(rep, logged)} />;
  }

  // chat precedence: explicit flag > the resumed session's own saved model/effort >
  // remembered prefs. A resumed session must come back running what it ran (not the
  // prefs default); an explicit flag is the user overriding that, so it still wins.
  // model comes from the resolved ENGINE's own remembered model, a claude model id
  // (e.g. "sonnet") sent to codex's API is a 400, so the two never share one field,
  // and the session's saved model only applies when it reopens on the same engine.
  const effectiveCli = options.cli ?? prefs.lastCli ?? "claude";
  const sessionModel = resumed && resumed.cli === effectiveCli ? resumed.model : undefined;
  const effective: AppOptions = {
    ...options,
    cli: effectiveCli,
    model: options.model ?? sessionModel ?? (effectiveCli === "codex" ? prefs.lastModelCodex : prefs.lastModelClaude),
    effort: options.effort ?? resumed?.effort ?? prefs.lastEffort,
    resume: options.resume ?? (options.continue ? prefs.lastSessionId : undefined),
  };
  return (
    <Chat
      runtime={runtime!}
      wallet={wallet!}
      address={address}
      report={report}
      options={effective}
      approval={approval.current}
      cloudStatus={cloudStatus}
      onRebuildRuntime={rebuildRuntime}
    />
  );
}
