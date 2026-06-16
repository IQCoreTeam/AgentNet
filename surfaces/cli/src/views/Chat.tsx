import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import type { AgentRuntime, Wallet } from "@iqlabs-official/agent-sdk/runtime/contract";
import type { CliReport } from "@iqlabs-official/agent-sdk";
import type { ApprovalRequest } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import type { AppOptions } from "../app.js";
import type { InkApprovalChannel } from "../InkApprovalChannel.js";
import { useChat, type Engine } from "../hooks/useChat.js";
import { useFrameLoop } from "../hooks/useFrameLoop.js";
import {
  getStorageInfo,
  getCodexApiKey,
  STORAGE_OPTIONS,
  type StorageKind,
  maskedHeliusKey,
  saveHeliusKey,
  ownedSkills,
  hasDasRpc,
  marketplaceEnv,
} from "@iqlabs-official/agent-sdk";
import { Select } from "@inkjs/ui";
import { chooseStorage } from "../bootstrap.js";
import { copyToClipboard } from "../clipboard.js";
import { Message } from "../components/Message.js";
import { StatusLine } from "../components/StatusLine.js";
import { ApprovalCard } from "../components/ApprovalCard.js";
import { Celebrate } from "../components/Celebrate.js";
import { Composer } from "../components/Composer.js";
import { WelcomePanel, type PanelField, type OwnedSkill } from "../components/WelcomePanel.js";
import { NoticeBanner } from "../components/NoticeBanner.js";
import { Footer } from "../components/Footer.js";
import { SessionList } from "./SessionList.js";
import { SkillMarket } from "./SkillMarket.js";
import { ModelPicker } from "./ModelPicker.js";
import { EffortPicker } from "./EffortPicker.js";
import type { EffortLevel } from "../prefs.js";
import { type Mood } from "../components/Iggy.js";
import { thinkingLabels, colors, copy, pick } from "../theme.js";

// IQ-flavored rotating label while a turn runs.
function ThinkingLine() {
  const i = useFrameLoop(thinkingLabels.length, 1.2);
  return (
    <Box paddingLeft={2} marginTop={1}>
      <Text color={colors.iqViolet}>{thinkingLabels[i]}</Text>
    </Box>
  );
}

export function Chat({
  runtime,
  wallet,
  options,
  approval,
  address,
}: {
  runtime: AgentRuntime;
  wallet: Wallet;
  address: string;
  report: CliReport;
  options: AppOptions;
  approval: InkApprovalChannel | null;
}) {
  const { exit } = useApp();
  const cwd = options.cwd ?? process.cwd();
  const chat = useChat(runtime, {
    cli: options.cli ?? "claude",
    model: options.model,
    effort: options.effort,
    cwd,
    resume: options.resume,
    approval: approval ?? undefined,
  });
  const [notice, setNotice] = useState("");
  // Welcome-panel data, fetched once on mount: cloud/storage (local-only → null), the
  // masked Helius key ("••••AB12" or null = default RPC), and the wallet's owned skills.
  const [cloud, setCloud] = useState<{ kind: string; account?: string } | null>(null);
  const [heliusMasked, setHeliusMasked] = useState<string | null>(null);
  // null = still fetching (the panel shows "loading…"); [] = fetched, none owned.
  const [skills, setSkills] = useState<OwnedSkill[] | null>(null);
  // Whether a DAS-capable RPC is configured. The public default RPC can't serve
  // getAssetsByOwner, so owned skills come back empty there — the panel uses this to
  // tell "you have no skills" apart from "set a Helius key to read your skills".
  const [dasReady, setDasReady] = useState(true);
  // the skill-market actions (search/detail/buy/balance), resolved once from the wallet —
  // the same marketplaceEnv functions the VSCode market uses, driven from this TUI.
  const [market, setMarket] = useState<Awaited<ReturnType<typeof marketplaceEnv>> | null>(null);
  // installed skill slugs (dir names) — drives the market's "owned" badge.
  const [installed, setInstalled] = useState<string[]>([]);
  useEffect(() => {
    void getStorageInfo().then((info) => setCloud(info ?? null));
    void maskedHeliusKey().then(setHeliusMasked);
    void hasDasRpc().then(setDasReady);
    // owned-skills needs a DAS RPC; best-effort, leave empty on failure.
    setSkills(null);
    void ownedSkills(address).then(setSkills).catch(() => setSkills([]));
    void marketplaceEnv(wallet).then((env) => {
      setMarket(env);
      void env.ownedSkills().then(setInstalled).catch(() => {});
    });
  }, [address, wallet]);
  const [showBtw, setShowBtw] = useState(false);
  const [btwQuestion, setBtwQuestion] = useState("");
  const [btwAnswer, setBtwAnswer] = useState("");
  const [btwBusy, setBtwBusy] = useState(false);
  const [btwElapsed, setBtwElapsed] = useState(0);
  const btwHandleRef = useRef<any>(null);

  // tick elapsed while btwBusy
  useEffect(() => {
    if (!btwBusy) return;
    const start = Date.now();
    setBtwElapsed(0);
    const id = setInterval(() => setBtwElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [btwBusy]);

  const startBtwQuery = useCallback((question: string) => {
    if (!chat.pendingId) {
      setNotice("please start/resume a session first — try /resume or say hi");
      return;
    }
    if (chat.busy) {
      setNotice("/btw unavailable while a turn is running — wait for it to finish");
      return;
    }
    // stop any leftover handle from a previous btw query
    if (btwHandleRef.current) {
      btwHandleRef.current.stop();
      btwHandleRef.current = null;
    }
    setShowBtw(true);
    setBtwQuestion(question);
    setBtwAnswer("");
    setBtwBusy(true);

    void (async () => {
      try {
        const h = await runtime.startSession({
          cli: chat.cli,
          model: chat.model,
          cwd,
          sessionId: chat.pendingId,
          stream: true,
          ephemeral: true,
        });
        btwHandleRef.current = h;
        h.onMessage((m) => {
          if (m.role === "assistant") {
            setBtwAnswer(m.text);
          }
        });
        h.onTurnEnd(() => {
          setBtwBusy(false);
          btwHandleRef.current = null;
        });
        h.send(question);
      } catch (e: any) {
        setBtwAnswer((prev) => prev + `\n[error] ${e.message || String(e)}`);
        setBtwBusy(false);
        btwHandleRef.current = null;
      }
    })();
  }, [chat.cli, chat.model, chat.pendingId, cwd, runtime]);

  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [activeDiffFileIdx, setActiveDiffFileIdx] = useState(0);
  // approval reply mode: null = y/a/n buttons; "reason" = typing a deny reason;
  // "edit" = editing the bash command before allowing.
  const [replyMode, setReplyMode] = useState<"reason" | "edit" | null>(null);
  const [replyText, setReplyText] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [showEfforts, setShowEfforts] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [accountLines, setAccountLines] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  // welcome control panel: focus stays on the composer by default; Ctrl+S moves focus into
  // the panel to edit settings. showCloud opens the storage picker from the panel's cloud row.
  const [panelFocused, setPanelFocused] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [celebrate, setCelebrate] = useState<"sparkle" | "confetti" | null>(null);
  const [eggMood, setEggMood] = useState<Mood | null>(null);
  const [idle, setIdle] = useState(false);
  const prevBusy = useRef(false);
  const konami = useRef<string[]>([]);

  // celebration on turn completion: confetti if the last tool looks like a win, else a
  // quick sparkle. Disabled visually by Celebrate under --calm.
  useEffect(() => {
    if (prevBusy.current && !chat.busy && chat.messages.length) {
      const last = chat.messages[chat.messages.length - 1];
      // an engine error ends the turn too — don't celebrate it; show the calm error face.
      const errored =
        !!last &&
        last.role === "tool" &&
        (last.tool?.name === "Error" ||
          (last.tool?.exitCode !== undefined && last.tool.exitCode !== 0) ||
          /\b(engine\]|exited with code|error)/i.test(last.text));
      if (errored) {
        setEggMood("error");
      } else {
        const lastTool = [...chat.messages].reverse().find((m) => m.role === "tool");
        const win =
          !!lastTool &&
          (lastTool.tool?.exitCode === 0 || /\b\d+\s+pass(ing|ed)\b/i.test(lastTool.tool?.output ?? ""));
        setCelebrate(win ? "confetti" : "sparkle");
        setEggMood("success");
      }
      const t = setTimeout(() => {
        setCelebrate(null);
        setEggMood(null);
      }, 1600);
      prevBusy.current = chat.busy;
      return () => clearTimeout(t);
    }
    prevBusy.current = chat.busy;
  }, [chat.busy, chat.messages]);

  // idle nudge: Iggy dozes off after a minute of no activity. Any input resets it.
  useEffect(() => {
    setIdle(false);
    const t = setTimeout(() => setIdle(true), 60_000);
    return () => clearTimeout(t);
  }, [chat.messages.length, chat.busy, notice]);

  // Esc cancels a running turn (only while busy and no approval pending).
  useInput(
    (_i, key) => {
      if (key.escape) {
        chat.interrupt();
        setNotice("interrupted.");
      }
    },
    { isActive: chat.busy && !pendingApproval },
  );

  // surface tool-approval requests from the engine; reset reply state on each new one.
  useEffect(
    () =>
      approval?.subscribe((req) => {
        setPendingApproval(req);
        setReplyMode(null);
        setReplyText("");
        setDiffExpanded(false);
        setActiveDiffFileIdx(0);
      }),
    [approval],
  );

  // buttons mode: y/a/n decide; r/e open a typed reply; Esc denies (so walking away or
  // bailing never blocks the engine forever).
  useInput(
    (input, key) => {
      if (!pendingApproval || !approval) return;
      if (key.escape || input === "n")
        return approval.resolve(pendingApproval.id, { outcome: "deny", reason: "denied by user" });
      if (input === "y") return approval.resolve(pendingApproval.id, { outcome: "once" });
      if (input === "a") return approval.resolve(pendingApproval.id, { outcome: "always" });
      if (input === "r") return setReplyMode("reason");
      if (input === "d") return setDiffExpanded(!diffExpanded);
      if (/^[1-9]$/.test(input)) {
        const idx = parseInt(input, 10) - 1;
        setActiveDiffFileIdx(idx);
        return;
      }
      if (input === "e" && pendingApproval.kind === "bash") {
        setReplyText(pendingApproval.command ?? "");
        return setReplyMode("edit");
      }
    },
    { isActive: !!pendingApproval && !replyMode },
  );

  // reply mode: minimal line editor for a deny reason or an edited command.
  useInput(
    (input, key) => {
      if (!pendingApproval || !approval) return;
      if (key.escape) return setReplyMode(null); // back to buttons
      if (key.return) {
        const text = replyText.trim();
        if (replyMode === "reason") {
          approval.resolve(pendingApproval.id, { outcome: "deny", reason: text || "denied by user" });
        } else {
          approval.resolve(pendingApproval.id, {
            outcome: "once",
            updatedInput: { ...(pendingApproval.input ?? {}), command: text },
          });
        }
        return;
      }
      if (key.backspace || key.delete) return setReplyText((t) => t.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setReplyText((t) => t + input);
    },
    { isActive: !!pendingApproval && !!replyMode },
  );

  // hidden: ↑↑↓↓ toggles a playful "turbo glow" acknowledgement.
  useInput(
    (_input, key) => {
      const k = key.upArrow ? "U" : key.downArrow ? "D" : "";
      if (!k) return;
      konami.current = [...konami.current, k].slice(-4);
      if (konami.current.join("") === "UUDD") {
        setNotice("⚡ turbo glow engaged — you found it ✦");
        konami.current = [];
      }
    },
    { isActive: !pendingApproval && !showSessions && !showModels && !showEfforts && !showBtw && !showAccount && !showSettings },
  );

  // Ctrl+S moves focus from the composer into the welcome panel (only while the panel is
  // showing: empty, idle session, no overlay open). Esc inside the panel returns focus.
  useInput(
    (input, key) => {
      if (key.ctrl && input === "s") setPanelFocused(true);
    },
    {
      isActive:
        chat.messages.length === 0 &&
        !chat.busy &&
        !panelFocused &&
        !pendingApproval &&
        !showSessions &&
        !showModels &&
        !showEfforts &&
        !showBtw &&
        !showAccount &&
        !showSettings &&
        !showCloud,
    },
  );

  useInput(
    (_input, key) => { if (key.escape || key.return) setShowAccount(false); },
    { isActive: showAccount },
  );

  useInput(
    (_input, key) => { if (key.escape || key.return) setShowSettings(false); },
    { isActive: showSettings },
  );

  // Esc closes the cloud/storage picker (Select handles its own arrows + enter).
  useInput(
    (_input, key) => { if (key.escape) setShowCloud(false); },
    { isActive: showCloud },
  );

  // Escape or Return closes the /btw overlay.
  useInput(
    (_input, key) => {
      if (key.escape || key.return) {
        setShowBtw(false);
        setBtwQuestion("");
        setBtwAnswer("");
        setBtwBusy(false);
        if (btwHandleRef.current) {
          btwHandleRef.current.stop();
          btwHandleRef.current = null;
        }
      }
    },
    { isActive: showBtw },
  );

  // welcome-panel [enter] on a field: edit it. engine toggles in place; cloud opens the
  // storage picker; wallet copies the address; github is not wired yet.
  function editPanelField(field: PanelField) {
    if (field === "engine") {
      const next: Engine = chat.cli === "claude" ? "codex" : "claude";
      chat.switchEngine(next);
      setNotice(`engine → ${next} (session carries over)`);
      setPanelFocused(false);
      return;
    }
    if (field === "cloud") {
      setShowCloud(true); // hands off to the storage picker; focus returns after applyCloud
      return;
    }
    if (field === "wallet") {
      void copyToClipboard(address).then((ok) =>
        setNotice(ok ? `copied wallet ${address}` : `wallet ${address}`),
      );
      setPanelFocused(false);
      return;
    }
    // github
    setNotice("github linking — coming soon");
    setPanelFocused(false);
  }

  // commit a Helius key from the panel's key editor. "" clears it (back to default RPC).
  // re-read the mask so the row reflects the new state; refresh owned skills now that a
  // DAS-capable RPC may be available.
  function setHelius(raw: string) {
    void saveHeliusKey(raw).then(async () => {
      setHeliusMasked(await maskedHeliusKey());
      setDasReady(await hasDasRpc());
      setSkills(null);
      void ownedSkills(address).then(setSkills).catch(() => setSkills([]));
      setNotice(raw.trim() ? "helius key saved" : "helius key cleared — using default rpc");
    });
    setPanelFocused(false);
  }

  function openMarket() {
    setPanelFocused(false);
    if (!market) {
      setNotice("skill market — still loading, try again in a moment");
      return;
    }
    setShowMarket(true);
  }

  // apply a storage choice picked from the panel. local applies in place; a cloud (gdrive)
  // needs the OAuth flow, which lives in onboarding — point there rather than half-doing it.
  function applyCloud(kind: StorageKind) {
    setShowCloud(false);
    setPanelFocused(false);
    if (kind === "local") {
      void chooseStorage({ kind: "local" }).then(() => {
        setCloud(null);
        setNotice("storage → local only");
      });
      return;
    }
    setNotice(`${kind} needs sign-in — re-run onboarding to connect (rm ~/.config/agentnet to reset)`);
  }

  function runSlash(raw: string) {
    const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "quit":
      case "q":
        setNotice(pick(copy.signoffs));
        setTimeout(() => exit(), 350);
        return;
      case "new":
        chat.newSession();
        setPanelFocused(false); // empty session again → panel shows, focus back on composer
        setNotice("fresh session — say hi");
        return;
      case "engine":
        if (arg === "claude" || arg === "codex") {
          chat.switchEngine(arg as Engine);
          setNotice(`switched to ${arg} (session carries over)`);
        } else setNotice("usage: /engine claude|codex");
        return;
      case "model":
        if (!arg) {
          setShowModels(true); // no arg → open the picker
          return;
        }
        chat.changeModel(arg);
        setNotice(`model → ${arg}`);
        return;
      case "models":
        setShowModels(true);
        return;
      case "effort": {
        const VALID: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
        if (!arg) {
          setShowEfforts(true);
          return;
        }
        if (arg === "default") {
          chat.changeEffort(undefined);
          setNotice("effort → default");
          return;
        }
        if (VALID.includes(arg as EffortLevel)) {
          chat.changeEffort(arg as EffortLevel);
          setNotice(`effort → ${arg}`);
        } else {
          setNotice("usage: /effort low|medium|high|xhigh|max|default");
        }
        return;
      }
      case "efforts":
        setShowEfforts(true);
        return;
      case "sessions":
      case "ls":
        void chat.refreshSessions();
        setShowSessions(true);
        return;
      case "resume": {
        const hit = chat.sessions.find((s) => s.sessionId.startsWith(arg));
        if (arg && hit) {
          void chat.openSession(hit.sessionId);
          setNotice(`resumed ${hit.title || hit.sessionId.slice(0, 8)}`);
        } else setNotice("usage: /resume <id-prefix> — see /sessions");
        return;
      }
      case "wallet":
        setNotice(`wallet ${address}`);
        return;
      case "iq":
        setNotice(`◆ ${pick(copy.iqFacts)}`);
        setEggMood("success");
        setTimeout(() => setEggMood(null), 2000);
        return;
      case "dance":
        setEggMood("dance");
        setNotice("♪ Iggy hits the floor");
        setTimeout(() => setEggMood(null), 3000);
        return;
      case "more":
        void chat.loadOlder();
        setNotice("loaded older history");
        return;
      case "compact":
        // claude/codex honor their own /compact command; pass it through as a turn.
        void chat.send("/compact");
        setNotice("compacting context…");
        return;
      case "clear":
        chat.clearView();
        setNotice("cleared (session kept — /more to restore)");
        return;
      case "copy": {
        const lastAsst = [...chat.messages].reverse().find((m) => m.role === "assistant");
        if (!lastAsst) {
          setNotice("nothing to copy yet");
          return;
        }
        void copyToClipboard(lastAsst.text).then((ok) =>
          setNotice(ok ? "copied last reply to clipboard" : "clipboard tool not available"),
        );
        return;
      }
      case "storage":
        void getStorageInfo().then((info) =>
          setNotice(info ? `storage: ${info.kind}${info.account ? ` (${info.account})` : ""}` : "storage: local only"),
        );
        return;
      case "account":
        void (async () => {
          const lines: string[] = [];
          if (chat.cli === "codex") {
            const key = await getCodexApiKey();
            lines.push(`engine    codex`);
            lines.push(`auth      ${key ? "API key" : "ChatGPT plan (device auth)"}`);
          } else {
            lines.push(`engine    claude`);
            lines.push(`auth      subscription`);
          }
          const win = chat.cli === "codex" ? 256_000 : 200_000;
          const used = chat.contextTokens ?? Math.round(chat.messages.reduce((n, m) => n + m.text.length, 0) / 4);
          lines.push(`model     ${chat.model ?? "default"}`);
          lines.push(`ctx used  ${used.toLocaleString()} / ${win.toLocaleString()} tokens`);
          setAccountLines(lines);
          setShowAccount(true);
        })();
        return;
      case "settings":
        setShowSettings(true);
        return;
      case "btw":
        if (!arg.trim()) {
          setNotice("usage: /btw <question>");
          return;
        }
        startBtwQuery(arg.trim());
        return;
      case "help":
        setNotice("/new /sessions /resume /more /compact /clear /copy /models /engine /effort /account /settings /wallet /storage /btw <question> /iq /quit · !cmd shell · Esc cancels · Ctrl+A/E/W/U edit");
        return;
      default:
        setNotice(`unknown command: /${cmd} — try /help`);
    }
  }

  function onSubmit(value: string) {
    const text = value.trim();
    if (!text) return;
    setNotice("");
    if (text.startsWith("/")) return runSlash(text);
    if (text.startsWith("!")) return chat.runBash(text.slice(1)); // quick local shell
    void chat.send(text);
  }

  const mood: Mood = eggMood ?? (pendingApproval ? "tool" : chat.busy ? "thinking" : idle ? "sleeping" : "idle");
  // context-left: prefer the engine's REAL per-turn usage; before the first turn reports,
  // fall back to a rough chars/4 estimate so the meter isn't blank.
  const WINDOW = chat.cli === "codex" ? 256_000 : 200_000;
  // Only fall back to char-count estimate when there are actual messages — otherwise
  // the bar shows 0/200k on every fresh session which is meaningless noise.
  const usedTokens =
    chat.contextTokens ??
    (chat.messages.length > 0
      ? chat.messages.reduce((n, m) => n + m.text.length, 0) / 4
      : undefined);
  const usedFrac = usedTokens !== undefined ? Math.min(1, usedTokens / WINDOW) : undefined;
  const ctxReal = chat.contextTokens !== undefined;

  // /account overlay.
  if (showAccount) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor={colors.iqCyan} flexDirection="column" paddingX={2} paddingY={1}>
          <Text bold color={colors.iqCyan}>account</Text>
          {accountLines.map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
          <Box marginTop={1}><Text dimColor>Esc / Enter  close</Text></Box>
        </Box>
      </Box>
    );
  }

  // /settings overlay.
  if (showSettings) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor={colors.iqCyan} flexDirection="column" paddingX={2} paddingY={1}>
          <Text bold color={colors.iqCyan}>settings</Text>
          <Text dimColor>{`engine    ${chat.cli}`}</Text>
          <Text dimColor>{`model     ${chat.model ?? "default"}`}</Text>
          <Text dimColor>{`effort    ${chat.effort ?? "default"}`}</Text>
          <Text dimColor>{`cwd       ${cwd}`}</Text>
          <Box marginTop={1}>
            <Text dimColor>{"/engine claude|codex  ·  /model <name>  ·  /models  ·  /effort <level>  ·  /efforts  to change"}</Text>
          </Box>
          <Box marginTop={1}><Text dimColor>Esc / Enter  close</Text></Box>
        </Box>
      </Box>
    );
  }

  // cloud/storage picker overlay — opened from the welcome panel's cloud row.
  if (showCloud) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor={colors.iqCyan} flexDirection="column" paddingX={2} paddingY={1}>
          <Text bold color={colors.iqCyan}>storage</Text>
          <Text dimColor>where your sessions live (local is always on — a cloud just mirrors it)</Text>
          <Box marginTop={1}>
            <Select
              options={STORAGE_OPTIONS.map((o) => ({ label: `${o.label} — ${o.needs}`, value: o.kind }))}
              onChange={(v) => applyCloud(v as StorageKind)}
            />
          </Box>
          <Box marginTop={1}><Text dimColor>Esc  close</Text></Box>
        </Box>
      </Box>
    );
  }

  // model picker overlay.
  if (showModels) {
    return (
      <ModelPicker
        cli={chat.cli}
        current={chat.model}
        onPick={(v) => {
          chat.changeModel(v);
          setNotice(`model → ${v ?? "default"}`);
          setShowModels(false);
        }}
        onClose={() => setShowModels(false)}
      />
    );
  }

  // effort picker overlay.
  if (showEfforts) {
    return (
      <EffortPicker
        current={chat.effort}
        onPick={(v) => {
          chat.changeEffort(v);
          setNotice(`effort → ${v ?? "default"}`);
          setShowEfforts(false);
        }}
        onClose={() => setShowEfforts(false)}
      />
    );
  }

  // session picker overlay — takes over input while open.
  if (showSessions) {
    return (
      <SessionList
        sessions={chat.sessions}
        activeId={chat.pendingId}
        onResume={(id) => {
          void chat.openSession(id);
          setShowSessions(false);
        }}
        onDelete={(id) => void chat.deleteSession(id)}
        onClose={() => setShowSessions(false)}
      />
    );
  }

  // skill-market overlay — search/list/detail/buy over marketplaceEnv. Takes over input
  // while open; Esc backs out a level (or closes from the list), like the VSCode market.
  if (showMarket && market) {
    return (
      <SkillMarket
        api={market}
        walletAddr={address}
        ownedNames={installed}
        onBought={() => {
          // a buy installs the skill — refresh the badge source + the welcome panel list.
          void market.ownedSkills().then(setInstalled).catch(() => {});
          void ownedSkills(address).then(setSkills).catch(() => {});
        }}
        onClose={() => setShowMarket(false)}
      />
    );
  }

  // /btw side-channel overlay.
  if (showBtw) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} paddingY={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">⚡ /btw (side-channel query)</Text>
          </Box>
          <Box flexDirection="row" marginBottom={1}>
            <Text bold color="white">Q: </Text>
            <Text color="cyan">{btwQuestion}</Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">A: </Text>
            {btwAnswer ? (
              <Text color="gray">{btwAnswer}</Text>
            ) : (
              <Text dimColor>Thinking...</Text>
            )}
          </Box>
          {btwBusy ? (
            <Box flexDirection="row" marginTop={1}>
              <Text color="cyan">⏱ {btwElapsed.toFixed(1)}s </Text>
              <Text dimColor>Loading answer from {chat.cli}...</Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text bold color="green">✔ Done. Press Escape or Enter to return to chat.</Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // the last message is rendered LIVE (dynamic) only while it's a streaming assistant;
  // everything else is committed to <Static>, which renders each line once and never
  // re-renders — so Iggy/spinner ticks don't repaint the whole scrollback. `epoch` resets
  // Static on wholesale changes (resume / new / scroll-back prepend).
  const lastMsg = chat.messages[chat.messages.length - 1];
  const streaming = chat.busy && lastMsg?.role === "assistant";
  const committed = streaming ? chat.messages.slice(0, -1) : chat.messages;
  const liveMsg = streaming ? lastMsg : null;

  // the welcome control panel shows on an empty, idle session. Focus stays on the composer
  // by default; Ctrl+S moves focus INTO the panel (panelActive), which then owns
  // tab/arrow/enter and disables the composer until Esc hands focus back.
  const showPanel = chat.messages.length === 0 && !chat.busy;
  const panelActive = showPanel && panelFocused;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* startup welcome panel — shown only on empty session so it doesn't re-appear.
          Logo-left / editable settings-right: wallet, cloud, engine + github. The composer
          keeps focus until Ctrl+S; then tab/enter control the panel, Esc returns to chat. */}
      {showPanel ? (
        <WelcomePanel
          walletAddr={address}
          cloud={cloud}
          engine={chat.cli}
          heliusMasked={heliusMasked}
          skills={skills}
          dasReady={dasReady}
          active={panelActive}
          onEdit={editPanelField}
          onSetHelius={setHelius}
          onOpenMarket={openMarket}
          onExit={() => setPanelFocused(false)}
        />
      ) : null}
      {showPanel ? <Text dimColor>{copy.emptySessions}</Text> : null}

      <Static key={chat.epoch} items={committed.map((m, i) => ({ m, i }))}>
        {({ m, i }) => <Message key={`${m.ts}-${i}`} msg={m} />}
      </Static>

      {chat.hasMore ? <Text dimColor>… older history above — /more to load</Text> : null}

      {liveMsg ? <Message msg={liveMsg} live /> : null}

      {chat.busy && !pendingApproval ? <ThinkingLine /> : null}

      {pendingApproval ? (
        <ApprovalCard
          req={pendingApproval}
          reply={replyMode}
          replyText={replyText}
          diffExpanded={diffExpanded}
          activeDiffFileIdx={activeDiffFileIdx}
        />
      ) : null}

      <Celebrate kind={celebrate} />
      {idle && !chat.busy ? <Text dimColor>{copy.idleNudge}</Text> : null}

      <StatusLine mood={mood} cli={chat.cli} model={chat.model} effort={chat.effort} cwd={cwd} elapsed={chat.busy ? chat.elapsed : undefined} ctx={usedFrac} ctxTokens={usedTokens !== undefined ? Math.round(usedTokens) : undefined} ctxWindow={usedFrac !== undefined ? WINDOW : undefined} ctxApprox={!ctxReal} />

      {/* hide the composer while an approval is pending — keys answer the card instead */}
      {!pendingApproval ? (
        <Box marginTop={1}>
          <Composer
            cwd={cwd}
            onSubmit={onSubmit}
            disabled={showSessions || panelActive}
            history={chat.messages.filter((m) => m.role === "user").map((m) => m.text)}
          />
        </Box>
      ) : null}
      {notice ? <NoticeBanner text={notice} /> : null}
      <Footer cli={chat.cli} model={chat.model} busy={chat.busy} />
    </Box>
  );
}
