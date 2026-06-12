import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { AgentRuntime } from "@iqlabs-official/agent-sdk/runtime/contract";
import { autoApprove, type StorageConfig, type CliReport } from "@iqlabs-official/agent-sdk";
import { InkApprovalChannel } from "./InkApprovalChannel.js";
import { Banner } from "./components/Banner.js";
import { BootChecklist, type BootStep } from "./components/BootChecklist.js";
import { Onboarding } from "./views/Onboarding.js";
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

type Phase = "boot" | "onboard" | "chat" | "error";

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
    { label: "loading wallet", status: "pending" },
    { label: "checking claude", status: "pending" },
    { label: "checking codex", status: "pending" },
    { label: "restoring storage", status: "pending" },
  ]);
  const [address, setAddress] = useState("");
  const [report, setReport] = useState<CliReport>({ claude: "missing", codex: "missing" });
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({});
  // tool-approval seam: --yolo skips the UI (auto-allow); otherwise prompts route here.
  const approval = React.useRef<InkApprovalChannel | null>(options.yolo ? null : new InkApprovalChannel());

  const set = (i: number, patch: Partial<BootStep>) =>
    setSteps((s) => s.map((step, j) => (j === i ? { ...step, ...patch } : step)));

  // connect wallet → runtime, then enter chat. Reused after onboarding too.
  async function go(addr: string, w: Awaited<ReturnType<typeof loadWallet>>["wallet"]) {
    set(3, { status: "pending", label: "connecting storage" });
    const rt = await buildRuntime(w, approval.current ?? autoApprove());
    setRuntime(rt);
    set(3, { status: "ok", label: "storage ready" });
    setPhase("chat");
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
        set(1, { status: rep.claude === "ok" ? "ok" : "fail", label: `claude ${rep.claude}` });
        set(2, { status: rep.codex === "ok" ? "ok" : "fail", label: `codex ${rep.codex}` });

        // onboard only on a TRUE first run: neither a finished-setup marker nor a
        // configured cloud. (Local-only writes no storage config, so the marker is what
        // stops the every-launch onboarding loop.)
        if (savedPrefs.onboarded || (await isInitialized())) {
          if (!alive) return;
          await go(addr, wallet);
        } else {
          if (!alive) return;
          set(3, { status: "ok", label: "storage: pick on next screen" });
          setPhase("onboard");
          onboardFinish.current = async (engine: "claude" | "codex", cfg?: StorageConfig) => {
            if (cfg) await chooseStorage(cfg);
            await savePrefs({ onboarded: true, lastCli: engine });
            await go(addr, wallet);
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

  // chat — apply remembered prefs as defaults (explicit flags win); --continue resumes
  // the most recent session.
  const effective: AppOptions = {
    ...options,
    cli: options.cli ?? prefs.lastCli ?? "claude",
    model: options.model ?? prefs.lastModel,
    effort: options.effort ?? prefs.lastEffort,
    resume: options.resume ?? (options.continue ? prefs.lastSessionId : undefined),
  };
  return (
    <Chat runtime={runtime!} address={address} report={report} options={effective} approval={approval.current} />
  );
}
