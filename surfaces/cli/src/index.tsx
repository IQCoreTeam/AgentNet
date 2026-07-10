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

// Diagnostics from the core/engine layer (codex app-server tracing, the claudeModels probe,
// bigint's native-binding fallback notice, etc.) are all plain console.error/warn calls —
// fine for vscode/mobile, where that goes to a log nobody's staring at, but the CLI's stderr
// IS the visible terminal: every such line punches through the Ink UI mid-render. Route them
// to a log file instead (same content, just not in front of the user), unless the user asked
// for exactly this kind of visibility (AGENTNET_DEBUG, or AGENTNET_PERF for the traffic-audit
// [perf] lines) — then leave the real console methods alone.
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
  .version("0.0.1")
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
    const r = await detectCli();
    console.log(`claude: ${r.claude}`);
    console.log(`codex:  ${r.codex}`);
  });

program.parse();
