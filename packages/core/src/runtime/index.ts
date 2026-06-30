// AgentRuntime implementation — wires spawn + parse + append-on-the-fly.
// startSession() spawns the CLI, turns its output into ChatMessages (onMessage),
// and APPENDS each message to the encrypted log as it happens (no full rewrite).
// Messages seen before the real sessionId arrives are queued, then flushed once
// the CLI reveals its id. The UI just calls startSession + send + onMessage.

import { Connection } from "@solana/web3.js";
import { spawnCli } from "./spawn.js";
import { SessionStore } from "../account/store.js";
import { prepareResume } from "./inject/index.js";
import { getDeviceProfile, buildDeviceNotice } from "../core/device.js";
import { MemorySync, updateSkillsSection } from "../memory/index.js";
import { setSkillShoppingActive } from "../skill-market/passive.js";
import { setMakeSkillActive } from "../skill-market/makeSkill.js";
import { createAgentSdkMcpServer, newVerifyGuard, agentNetAllowedTools, AGENTNET_MCP_SERVER } from "../skill-market/index.js";
import { createClaudexMcpServer, claudexAllowedTools, CLAUDEX_MCP_SERVER, isLimitError, type ClaudexHooks } from "./codexSubagent.js";
import { resolveRpcUrl, hasDasRpc, loadGithubToken } from "../core/rpc.js";
import { getCodexApiKey } from "../account/codexAuth.js";
import type { ApprovalChannel } from "./approval/channel.js";
import { engineBinary } from "./contract.js";
import type {
  AgentRuntime,
  Cli,
  ChatMessage,
  SessionHandle,
  SessionMeta,
  StorageAdapter,
  Wallet,
} from "./contract.js";


// Skill-shopping wiring (plans/skill-shopping.md), built fresh per session from the
// persisted toggle. ON installs the bundled skill-shopping SKILL.md into both runtimes'
// skills dirs (so either engine discovers it) and — for Claude — wires the marketplace
// MCP tools so the agent can act on it; OFF moves the skill out to the holding dir and
// wires no tools (fully quiet, no marketplace surface). All best-effort: a failure here
// must not block the session, just leave skill-shopping inert this run.
//
// Codex gets MCP via a CHILD PROCESS (codex app-server loads servers from config, not an
// in-process object): Phase 1 wires a READ-ONLY stdio server (search/verify only) when the
// surface has bundled the standalone entry and points AGENTNET_MCP_STDIO at it. Trading
// (buy/publish) stays Claude-only until Codex's MCP-tool approval is routed to the card.
async function buildPassiveSpawn(
  cli: Cli,
  wallet: Wallet,
  cwd: string,
  claudexHooks: ClaudexHooks,
  onMarketEvent?: (e: import("../chat/marketMessages.js").MarketEvent) => void,
): Promise<{ mcpServers?: Record<string, unknown>; allowedTools?: string[]; codexMcp?: { name: string; command: string; args: string[] } }> {
  // Skill-shopping is a BUILT-IN now: always on and hidden from the UI toggle. Every spawn
  // (re)installs the bundled skill so a fresh install on ANY surface (mobile/cli/vscode) has
  // it by default — no user opt-in. (The marketplace MCP tools below still require Claude +
  // a DAS RPC key; this only removes the on/off gate.)
  const on = true;

  // Ensure the bundled skills are present in the scanned skills dirs (both engines):
  // skill-shopping (the BUY flow) and make-skill (the PUBLISH flow). Both are built-in,
  // description-driven (passive) skills — the agent reaches for either via progressive
  // disclosure. The costly steps (buy/publish mint) are still gated in code (PROMPT_BEFORE_USE).
  try {
    await setSkillShoppingActive(on);
    await setMakeSkillActive(on);
  } catch (e) {
    console.warn("[bundled-skills] install failed:", e);
  }

  // Codex (Phase 1): a separate `node <entry>` stdio MCP server, read-only. Needs the
  // surface to have bundled the entry (AGENTNET_MCP_STDIO) AND a readable catalog (DAS).
  // (claudex runs the claude binary, so it takes the Claude branch below.)
  if (engineBinary(cli) === "codex") {
    const entry = process.env.AGENTNET_MCP_STDIO;
    if (!entry || !(await hasDasRpc())) return {};
    // command = "node" (PATH-resolved by codex when it spawns the server), NOT
    // process.execPath: in the VSCode extension host that's the Electron binary, which
    // won't run a script as plain node. "node" is the universal MCP-server convention.
    return { codexMcp: { name: AGENTNET_MCP_SERVER, command: "node", args: [entry] } };
  }

  // Claude: wire the marketplace MCP tools (search → verify → buy). NO Helius-key gate —
  // search_skills falls back to the INDEXER when no key is set (the catalog is readable
  // without DAS; see its handler), and verify/buy/publish use `conn` (resolveRpcUrl, which
  // falls back to the public RPC) directly. A stored Helius key still upgrades search to DAS.
  const conn = new Connection(await resolveRpcUrl(), "confirmed");
  const server = createAgentSdkMcpServer(conn, wallet, wallet.address, newVerifyGuard(), onMarketEvent);
  // Claudex "Team mode" (plans/claudex-team-mode.md): give the lead Claude session the
  // fan-out tool so it can spawn parallel Codex workers. Workers are spawned via spawnCli
  // directly, so they never get this tool back — depth guard is automatic, no recursion.
  // The claudex ENGINE → workers may EDIT files; plain claude → read-only researchers and
  // Claude applies any changes itself. (Both get the tool; only the engine flips write.)
  const claudex = createClaudexMcpServer(cwd, cli === "claudex", claudexHooks);
  return {
    mcpServers: { [AGENTNET_MCP_SERVER]: server, [CLAUDEX_MCP_SERVER]: claudex },
    allowedTools: [...agentNetAllowedTools(), ...claudexAllowedTools()],
  };
}

// `approval` is the swappable decision source (webview buttons / auto / push). The
// surface passes one in; omit it and tool use auto-allows (safe local default).
export function createRuntime(
  wallet: Wallet,
  storage: StorageAdapter,
  approval?: ApprovalChannel,
): AgentRuntime {
  const store = new SessionStore(wallet, storage);
  // Shared memory (issue #18): same wallet + storage as sessions. Injected into the
  // CLI's native memory files before it starts; captured back from Claude after turns.
  const memory = new MemorySync(wallet, storage);

  return {
    async startSession(opts): Promise<SessionHandle> {
      const device = await getDeviceProfile();
      // claudex is an identity, not a binary — talk to the claude CLI for resume/memory/
      // skills/spawn, but keep opts.cli ("claudex") for stored-session identity + badges.
      const engine = engineBinary(opts.cli);
      // RESUME: opts.sessionId is the CANONICAL id. Rewrite its history into the
      // target cli's native jsonl and resume under the NATIVE id (claude/codex only
      // accept their own ids) — this is what lets a session cross between CLIs.
      // FRESH: no sessionId; the cli mints its own, which becomes the canonical id.
      const resuming = !!opts.sessionId;
      const resumeResult = resuming
        ? await prepareResume(store, engine, opts.cwd, opts.sessionId!, opts.ephemeral)
        : undefined;
      const nativeId = resumeResult?.nativeId;

      let pendingDeviceNotice: string | null = null;
      if (resuming && resumeResult) {
        if (resumeResult.hasMessages && resumeResult.lastDevice?.id && resumeResult.lastDevice.id !== device.id) {
          pendingDeviceNotice = buildDeviceNotice(resumeResult.lastDevice, device);
          if (!opts.ephemeral) await store.recordMeta({
            sessionId: opts.sessionId!,
            cli: opts.cli,
            title: resumeResult.title ?? "",
            ts: Date.now(),
            lastDevice: device,
          });
        }
      }

      // Inject the project's shared memory into this CLI's native files (Claude's
      // memory dir / Codex's AGENTS.md) BEFORE it starts so it loads this run. Best
      // effort — a memory/storage hiccup must not block starting the session.
      let enabledSkills: string[] | undefined;
      try {
        await memory.injectAtStart(engine, opts.cwd);
        // After memory is written, refresh the managed "your skills" line so the agent
        // passively knows which skills are installed (no system-prompt nudge, no RPC).
        // Must run AFTER injectAtStart, which regenerates MEMORY.md / AGENTS.md.
        const skills = await updateSkillsSection(engine, opts.cwd);
        if (engine === "claude" && skills.length) enabledSkills = skills.map((s) => s.name);
      } catch (e) {
        console.warn("[memory] inject failed:", e);
      }

      // Claudex Team mode hooks: let the in-process fan-out tool talk to THIS live session.
      // notify → the skill marquee (live war-room cue); approval → the one merge gate before
      // workers touch files; sessionId → tag that approval. The closures read sessionId/
      // skillCbs which are declared just below — they're only CALLED later (during a turn),
      // so this forward reference is safe.
      const claudexHooks = {
        notify: (text: string) => { for (const cb of skillCbs) cb(text); },
        approval: opts.approval ?? approval,
        sessionId: () => sessionId,
      };

      // Skill-shopping (plans/skill-shopping.md): install/remove the bundled skill per the
      // toggle + (Claude, ON) wire the marketplace MCP tools. Best-effort.
      let passive: Awaited<ReturnType<typeof buildPassiveSpawn>> = {};
      try {
        passive = await buildPassiveSpawn(opts.cli, wallet, opts.cwd, claudexHooks, opts.onMarketEvent);
      } catch (e) {
        console.warn("[skill-shopping] setup failed:", e);
      }

      // per-session approval channel (each panel passes its own) wins; fall back to
      // the runtime-level default channel.
      const apiKey = opts.apiKey || (opts.cli === "codex" ? (await getCodexApiKey().catch(() => undefined)) ?? undefined : undefined);
      // Hand the configured GitHub token to the agent so its git can clone/push private repos
      // (e.g. on mobile, where the proot guest has no credentials). spawn.ts turns it into a
      // github.com-scoped, process-scoped credential helper — the user's global git is untouched.
      const githubToken = (await loadGithubToken().catch(() => null))?.token || undefined;
      const cli = spawnCli({ ...opts, sessionId: nativeId, approval: opts.approval ?? approval, apiKey, githubToken, enabledSkills, ...passive });

      // Storage key stays the CANONICAL id while resuming; the cli's emitted (native)
      // id must NOT overwrite it, or appended turns land in the wrong log.
      let sessionId = opts.sessionId ?? ""; // canonical; "" until a fresh cli reveals it
      let title = "";
      const msgCbs: Array<(m: ChatMessage) => void> = [];
      const turnCbs: Array<() => void> = [];
      const skillCbs: Array<(name: string) => void> = []; // "Casting <skill>" marquee
      const usageCbs: Array<(n: number, window?: number) => void> = [];
      const compactCbs: Array<() => void> = [];
      const pending: ChatMessage[] = []; // messages awaiting a known sessionId

      const meta = () => ({ sessionId, cli: opts.cli, title, ts: Date.now(), lastDevice: device });

      // Show the message to the UI, then append it to the encrypted log. Stamp the
      // producing CLI on every message so the UI badges each turn with the right
      // engine even in a cross-CLI session. Before sessionId is known, queue;
      // flush() drains the queue once it is.
      const emit = (m: ChatMessage) => {
        if (!m.cli) m.cli = opts.cli;
        if (!title && m.role === "user") title = m.text.slice(0, 60);
        for (const cb of msgCbs) cb(m);
        // streaming deltas are for the live UI only — never persist them. The final
        // (partial:false) assistant message carries the full text and IS stored below.
        if (m.partial) return;
        if (opts.ephemeral) return; // Do not save ephemeral messages to the store.
        if (sessionId) void store.appendMessage(meta(), m);
        else pending.push(m);
      };

      const flush = async () => {
        while (pending.length) await store.appendMessage(meta(), pending.shift()!);
      };

      // Engine events (already mapped to ChatMessages by spawn/convert). A FRESH
      // session adopts the engine's revealed id as canonical; while resuming, the
      // canonical id is already set so onSessionId is a no-op for us.
      cli.onSessionId((id: string) => {
        if (sessionId) return;
        sessionId = id;
        void flush();
      });
      cli.onMessage((m: ChatMessage) => emit(m));
      // A skill firing is a transient UI cue, not a transcript entry — fan it out to
      // listeners without persisting it (issue #17).
      cli.onSkill((name: string) => { for (const cb of skillCbs) cb(name); });
      cli.onUsage((n: number, window?: number) => { for (const cb of usageCbs) cb(n, window); });
      cli.onCompact(() => { for (const cb of compactCbs) cb(); });
      cli.onTurnEnd(() => {
        if (opts.ephemeral) {
          for (const cb of turnCbs) cb();
          return;
        }
        void flush().then(() => {
          for (const cb of turnCbs) cb();
        });
        // Capture any memory Claude wrote this turn back to Drive (stock Codex never
        // writes memory, so only Claude is captured). Fire-and-forget; best effort.
        if (engine === "claude") {
          void memory.captureFromClaude(opts.cwd).catch((e) =>
            console.warn("[memory] capture failed:", e),
          );
        }
      });

      // Surface failures instead of going silent: an engine error shows as a tool
      // message and ends the turn so the UI unblocks (it used to wait forever).
      let stopped = false; // we asked it to stop (tab/model switch) → not an error
      cli.onError((text: string) => {
        if (stopped) return;
        // A usage/rate limit on the LEAD engine is common and actionable — show a clean,
        // human message (keep the raw text appended for debugging) instead of a raw stack.
        const shown = isLimitError(text)
          ? `${opts.cli} hit a usage/rate limit — try again in a bit, or switch engine. (${text.trim().slice(0, 200)})`
          : text;
        emit({ role: "tool", text: shown, ts: Date.now() });
        void flush().then(() => {
          for (const cb of turnCbs) cb();
        });
      });

      return {
        get sessionId() {
          return sessionId;
        },
        cli: opts.cli,
        send(userText: string, images?: import("./contract.js").ImageInput[]) {
          // Persist only a COUNT of attached images, never the base64 (keeps the encrypted
          // log small). The live UI still gets thumbnails — it holds the originals itself.
          emit({ role: "user", text: userText, ts: Date.now(), imageCount: images?.length || undefined });
          const textToSend = pendingDeviceNotice
            ? pendingDeviceNotice + "\n\n" + userText
            : userText;
          pendingDeviceNotice = null;
          cli.send(textToSend, images);
        },
        runSlashCommand(command: string, arg?: string) {
          cli.runSlashCommand?.(command, arg);
        },
        onMessage(cb) {
          msgCbs.push(cb);
        },
        onTurnEnd(cb) {
          turnCbs.push(cb);
        },
        onSkill(cb) {
          skillCbs.push(cb);
        },
        onUsage(cb) {
          usageCbs.push(cb);
        },
        onCompact(cb) {
          compactCbs.push(cb);
        },
        interrupt() {
          cli.interrupt(); // stop the current turn; the session stays open for the next send
        },
        stop() {
          stopped = true; // mark so the resulting exit isn't reported as a failure
          cli.stop();
        },
        updateMode(mode) {
          cli.updateMode?.(mode);
        },
      };
    },

    async listSessions(): Promise<SessionMeta[]> {
      return store.listMine();
    },

    async loadSession(sessionId: string) {
      return store.loadLatest(sessionId); // newest page + cursor to older
    },

    async loadSessionLocal(sessionId: string) {
      return store.loadLatestLocal(sessionId); // local tier only — never blocks on cloud
    },

    async loadMore(sessionId: string, cursor: number) {
      return store.loadOlder(sessionId, cursor); // the page before `cursor`
    },

    async deleteSession(sessionId: string): Promise<void> {
      await store.remove(sessionId);
    },
  };
}
