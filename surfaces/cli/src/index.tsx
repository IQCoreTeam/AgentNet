import { render } from "ink";
import React from "react";
import { program } from "commander";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DelightProvider } from "./components/DelightProvider.js";
import { App, type AppOptions } from "./app.js";
import { detectCli } from "./bootstrap.js";
import { readPrefsSync, savePrefs } from "./prefs.js";
import { checkCliUpdate, installedCliVersion, CLI_UPDATE_COMMAND } from "./selfUpdate.js";
import { installStdoutFilter } from "./cursorPin.js";

// Diagnostics from the core/engine layer (codex app-server tracing, the claudeModels probe,
// bigint's native-binding fallback notice, etc.) are all plain console.error/warn calls —
// fine for vscode/mobile, where that goes to a log nobody's staring at, but the CLI's stderr
// IS the visible terminal: every such line punches through the Ink UI mid-render. Route them
// to a log file instead (same content, just not in front of the user), unless the user asked
// for exactly this kind of visibility (AGENTNET_DEBUG, or AGENTNET_PERF for the traffic-audit
// [perf] lines) — then leave the real console methods alone.
// Process-level warnings (the punycode DeprecationWarning class) get the same treatment but
// must be caught earlier: they fire while the dependency chunks evaluate, before any code in
// this module runs, so that capture lives in the tsup banner (see tsup.config.ts). It logs
// them to the same file below.
function quietDiagnosticsToFile() {
  if (process.env.AGENTNET_DEBUG || process.env.AGENTNET_PERF) return;
  const logFile = join(homedir(), ".agentnet", "cli-debug.log");
  const redirect = (level: string) => (...args: unknown[]) => {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] ${level}: ${args.map(String).join(" ")}\n`);
    } catch {
      /* best-effort — a logging failure must never break the session */
    }
  };
  console.error = redirect("error");
  console.warn = redirect("warn");
}

// Launch the interactive TUI with the given options (and optional session to resume).
// The TUI needs a real terminal (raw-mode keyboard input); when piped/redirected we
// bail with a friendly hint instead of crashing in Ink's input layer.
function launch(options: AppOptions, calmFlag?: boolean) {
  // --calm is remembered: passing it once persists; later launches stay calm.
  const calm = calmFlag || readPrefsSync().calm;
  if (calmFlag) void savePrefs({ calm: true });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "agentnet needs an interactive terminal. Run it directly (not piped), " +
        "or use `agentnet doctor` for a non-interactive check.",
    );
    process.exit(1);
  }
  quietDiagnosticsToFile();
  // Some terminals / tmux configs leave mouse reporting ON for us even though we never use
  // the mouse. Those click/scroll escape sequences (the stray "…;13;33M" coordinates) then
  // leak into the input as garbage text and muddy the render. Turn every mouse-reporting
  // mode OFF at startup so nothing arrives; we own no mouse behaviour to lose.
  if (process.stdout.isTTY) {
    const ESC = String.fromCharCode(27);
    process.stdout.write(`${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l${ESC}[?1015l`);
  }
  // Wrap every frame in a synchronized-output pair before ink paints anything, so the
  // terminal never shows a half-erased frame. Must run before render().
  installStdoutFilter();
  // Ink's own render() re-patches console.log/error/warn by default (patchConsole: true)
  // to inject any stray console output above the live UI — which is exactly what clobbers
  // our redirect above the moment render() runs, since Ink's patch installs AFTER ours and
  // forwards straight to the terminal. Disable Ink's patching so our file-redirect sticks.
  // exitOnCtrlC:false — Ink's default hard-quits on Ctrl+C, which kills a running turn
  // abruptly and skips our own teardown. We handle Ctrl+C ourselves instead (interrupt a
  // live turn, then quit on a second press), so it behaves like the other agent CLIs.
  render(
    <DelightProvider calm={calm}>
      <App options={options} />
    </DelightProvider>,
    { patchConsole: false, exitOnCtrlC: false },
  );
}

program
  .name("agentnet")
  .description("AgentNet: a playful, wallet-synced terminal for claude/codex")
  .version("0.1.3")
  .option("--calm", "disable animations (also honors NO_COLOR / non-TTY)")
  .option("--cli <engine>", "start on claude or codex (default: last used)")
  .option("--cwd <path>", "working directory for the agent")
  .option("--keypair <path>", "Solana keypair file (default: ~/.config/solana/id.json)")
  .option("--model <model>", "model to use")
  .option("--effort <level>", "reasoning effort: low|medium|high|xhigh|max")
  .option("-c, --continue", "resume your most recent session")
  .option("--yolo", "auto-approve all tool use (skip prompts)")
  .action((opts) => {
    launch(
      { cli: opts.cli, cwd: opts.cwd, keypair: opts.keypair, model: opts.model, effort: opts.effort, continue: opts.continue, yolo: opts.yolo },
      opts.calm,
    );
  });

// agentnet resume <id> → boot straight into a saved session.
program
  .command("resume <sessionId>")
  .description("resume a saved session by id")
  .action((sessionId, _opts, cmd) => {
    const g = cmd.parent.opts();
    launch({ cli: g.cli, cwd: g.cwd, keypair: g.keypair, model: g.model, resume: sessionId }, g.calm);
  });

// agentnet doctor → quick non-TUI engine install/login report.
program
  .command("doctor")
  .description("check claude/codex install + login status")
  .action(async () => {
    const [r, installed, update] = await Promise.all([
      detectCli(),
      installedCliVersion(),
      checkCliUpdate(),
    ]);
    console.log(`claude: ${r.claude}`);
    console.log(`codex:  ${r.codex}`);
    const self = update
      ? `v${update.installed} · v${update.latest} available · ${CLI_UPDATE_COMMAND}`
      : installed
        ? `v${installed}`
        : "version unknown";
    console.log(`agentnet: ${self}`);
  });

program.parse();
