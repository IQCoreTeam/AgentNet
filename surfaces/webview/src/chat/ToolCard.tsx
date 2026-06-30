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

// Claudex mark: one lead node fanning out to two workers. currentColor so the accent
// drives it. No emoji in the UI — this is the engine's glyph.
function ClaudexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M7.1 11 15.6 6.9M7.1 13 15.6 17.1" />
    </svg>
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
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5" style={{ color: "var(--claudex)" }}>
        <ClaudexIcon />
        <span className="font-medium">Team — {goals.length} Codex worker{goals.length === 1 ? "" : "s"} in parallel</span>
      </div>
      <div className="grid gap-1.5 p-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {goals.map((g, i) => (
          <div key={i} className="min-w-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
            <div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wider" style={{ color: "var(--claudex)" }}>codex #{i + 1}</div>
            <div className="text-zinc-300 [overflow-wrap:anywhere] break-words">{g}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-800 px-3 py-1.5 text-[0.62rem] text-zinc-500">
        Built by a team of rival AIs — Claude + Codex
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
