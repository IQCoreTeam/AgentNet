import type { ChatMessage } from "../transport/protocol";

// A tool invocation in the log (role:"tool"). bash shows the command + output; edit shows
// a unified diff; read/write show the file path. Mirrors the HTML webview's tool cards.
export function ToolCard({ tool }: { tool: NonNullable<ChatMessage["tool"]> }) {
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
