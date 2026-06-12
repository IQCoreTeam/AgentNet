import { render } from "ink";
import React from "react";
import { program } from "commander";
import { DelightProvider } from "./components/DelightProvider.js";
import { App, type AppOptions } from "./app.js";
import { detectCli } from "./bootstrap.js";
import { readPrefsSync, savePrefs } from "./prefs.js";

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
  render(
    <DelightProvider calm={calm}>
      <App options={options} />
    </DelightProvider>,
  );
}

program
  .name("agentnet")
  .description("AgentNet — a playful, wallet-synced terminal for claude/codex")
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
