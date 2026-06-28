import type { ChatMessage } from "../transport/protocol";

// A tool invocation in the log (role:"tool"). bash shows the command + output; edit shows
// a unified diff; read/write show the file path. Mirrors the HTML webview's tool cards.
export function ToolCard({ tool }: { tool: NonNullable<ChatMessage["tool"]> }) {
  // Claudex Team mode: render the fan-out as a war-room — one card per Codex worker.
  if (tool.name === "Claudex") return <WarRoom output={tool.output} />;
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 text-xs">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-zinc-400">
        <span className="font-mono">{glyph(tool)}</span>
        <span className="truncate">{tool.name ?? "tool"}</span>
        {typeof tool.exitCode === "number" && (
          <span
            className={`ml-auto font-mono ${tool.exitCode === 0 ? "text-emerald-500" : "text-red-400"}`}
          >
            exit {tool.exitCode}
          </span>
        )}
      </div>

      {tool.command && (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-zinc-200">
          $ {tool.command}
        </pre>
      )}
      {tool.file && !tool.diff && (
        <div className="px-3 py-2 font-mono text-zinc-300">{tool.file}</div>
      )}
      {tool.diff && <Diff diff={tool.diff} />}
      {tool.output && (
        <pre className="max-h-64 overflow-auto border-t border-zinc-800 px-3 py-2 font-mono text-zinc-400">
          {tool.output}
        </pre>
      )}
    </div>
  );
}

// War-room: the Claudex fan-out card. The tool output is {goals:string[]} (one per
// Codex worker). Each goal becomes a worker card — the visible "team" the user watches.
// ponytail: post-hoc cards (painted when the tool returns). Live per-worker progress
// bars need worker output streamed up through the MCP tool — add when it earns its keep.
function WarRoom({ output }: { output?: string }) {
  let goals: string[] = [];
  try {
    const parsed = output ? JSON.parse(output) : {};
    if (Array.isArray(parsed.goals)) goals = parsed.goals.map(String);
  } catch { /* malformed — show the header only */ }

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 text-xs">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-zinc-300">
        <span>🧬</span>
        <span className="font-medium">Team — {goals.length} Codex worker{goals.length === 1 ? "" : "s"} in parallel</span>
      </div>
      <div className="grid gap-1.5 p-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {goals.map((g, i) => (
          <div key={i} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
            <div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wider text-emerald-500">codex #{i + 1}</div>
            <div className="text-zinc-300">{g}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-800 px-3 py-1.5 text-[0.62rem] text-zinc-500">
        🛡️ built by a team of rival AIs — Claude + Codex
      </div>
    </div>
  );
}

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="overflow-x-auto px-3 py-2 font-mono">
      {diff.split("\n").map((ln, i) => (
        <div
          key={i}
          className={
            ln[0] === "+"
              ? "text-emerald-400"
              : ln[0] === "-"
                ? "text-red-400"
                : "text-zinc-400"
          }
        >
          {ln}
        </div>
      ))}
    </pre>
  );
}

function glyph(tool: NonNullable<ChatMessage["tool"]>): string {
  if (tool.command) return "$";
  if (tool.diff) return "✎";
  return "□";
}
