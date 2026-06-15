import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { AgentRuntime } from "@iqlabs-official/agent-sdk/runtime/contract";
import { autoApprove, type StorageConfig, type CliReport, remoteWallet } from "@iqlabs-official/agent-sdk";
import { Select } from "@inkjs/ui";
import qrcodeTerminal from "qrcode-terminal";
import { wcTransport } from "@iqlabs-official/wallet-connect";
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

type Phase = "boot" | "walletMenu" | "qrLogin" | "onboard" | "chat" | "error";

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
  const [wallet, setWallet] = useState<any | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({});
  const [qrCodeString, setQrCodeString] = useState("");
  const [qrStatus, setQrStatus] = useState("Initializing WalletConnect...");
  const approval = React.useRef<InkApprovalChannel | null>(options.yolo ? null : new InkApprovalChannel());

  const set = (i: number, patch: Partial<BootStep>) =>
    setSteps((s) => s.map((step, j) => (j === i ? { ...step, ...patch } : step)));

  async function go(addr: string, w: any) {
    set(3, { status: "pending", label: "connecting storage" });
    const rt = await buildRuntime(w, approval.current ?? autoApprove());
    setRuntime(rt);
    setWallet(w);
    set(3, { status: "ok", label: "storage ready" });
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    setPhase("chat");
  }

  async function runBootChecks(w: any, addr: string, savedPrefs: Prefs) {
    try {
      setAddress(addr);
      setWallet(w);
      set(0, { status: "ok", label: "wallet", detail: `${addr.slice(0, 6)}…${addr.slice(-4)}` });

      const rep = await detectCli();
      setReport(rep);
      set(1, { status: rep.claude === "ok" ? "ok" : "fail", label: `claude ${rep.claude}` });
      set(2, { status: rep.codex === "ok" ? "ok" : "fail", label: `codex ${rep.codex}` });

      if (savedPrefs.onboarded || (await isInitialized())) {
        await go(addr, w);
      } else {
        set(3, { status: "ok", label: "storage: pick on next screen" });
        setPhase("onboard");
        onboardFinish.current = async (engine: "claude" | "codex", cfg?: StorageConfig) => {
          if (cfg) await chooseStorage(cfg);
          await savePrefs({ onboarded: true, lastCli: engine });
          await go(addr, w);
        };
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function handleWalletSourceSelect(value: string) {
    if (value === "local") {
      setPhase("boot");
      setSteps([
        { label: "loading wallet", status: "pending" },
        { label: "checking claude", status: "pending" },
        { label: "checking codex", status: "pending" },
        { label: "restoring storage", status: "pending" },
      ]);
      try {
        const { wallet: w, address: addr } = await loadWallet(options.keypair);
        await runBootChecks(w, addr, prefs);
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    } else if (value === "qr") {
      setPhase("qrLogin");
      setQrStatus("Initializing WalletConnect...");
      setQrCodeString("");
      
      try {
        const projectId = process.env.REOWN_PROJECT_ID || "3fcc6b14d1b7473db311d1bfab721c0b";
        const transport = wcTransport({ projectId });
        const { uri, approved } = await transport.connect();
        
        qrcodeTerminal.generate(uri, { small: true }, (code) => {
          setQrCodeString(code);
          setQrStatus("Scan the QR code below with your Phantom or Solflare wallet app on your phone:");
        });

        const { address: addr } = await approved;
        setQrStatus("Connection approved! Signing session key message on your phone...");
        
        const SESSION_KEY_MESSAGE = "iq-sdk-derive-encryption-key-v1";
        const msgBytes = new TextEncoder().encode(SESSION_KEY_MESSAGE);
        
        const w = remoteWallet(transport, addr);
        await w.signMessage(msgBytes);
        
        setPhase("boot");
        setSteps([
          { label: "wallet connected", status: "ok", detail: `${addr.slice(0, 6)}…${addr.slice(-4)}` },
          { label: "checking claude", status: "pending" },
          { label: "checking codex", status: "pending" },
          { label: "restoring storage", status: "pending" },
        ]);
        
        await runBootChecks(w, addr, prefs);
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const savedPrefs = await readPrefs();
        if (!alive) return;
        setPrefs(savedPrefs);

        if (options.keypair || !process.stdin.isTTY) {
          const { wallet: w, address: addr } = await loadWallet(options.keypair);
          if (!alive) return;
          await runBootChecks(w, addr, savedPrefs);
        } else {
          setPhase("walletMenu");
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

  const onboardFinish = React.useRef<(engine: "claude" | "codex", cfg?: StorageConfig) => void>(() => {});

  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={colors.err}>couldn't start: {errMsg}</Text>
      </Box>
    );
  }

  if (phase === "walletMenu") {
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Banner />
        <Text color={colors.iqCyan}>Select Solana wallet source:</Text>
        <Select
          options={[
            { label: "Local keypair (~/.config/solana/id.json)", value: "local" },
            { label: "QR to login (Phone wallet)", value: "qr" },
          ]}
          onChange={handleWalletSourceSelect}
        />
      </Box>
    );
  }

  if (phase === "qrLogin") {
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Banner />
        <Text color={colors.iqCyan}>{qrStatus}</Text>
        {qrCodeString ? (
          <Box borderStyle="single" borderColor={colors.iqViolet} paddingX={1}>
            <Text>{qrCodeString}</Text>
          </Box>
        ) : null}
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

  const effective: AppOptions = {
    ...options,
    cli: options.cli ?? prefs.lastCli ?? "claude",
    model: options.model ?? prefs.lastModel,
    effort: options.effort ?? prefs.lastEffort,
    resume: options.resume ?? (options.continue ? prefs.lastSessionId : undefined),
  };
  return (
    <Chat runtime={runtime!} wallet={wallet!} address={address} report={report} options={effective} approval={approval.current} />
  );
}
