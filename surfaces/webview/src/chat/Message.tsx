import type { ChatMessage } from "../transport/protocol";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

// One log entry, rendered by role. Assistant text is markdown; user/thinking/summary are
// plain; tool entries become a ToolCard. Matches the HTML webview's bubble semantics.
export function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === "tool" && msg.tool) return <ToolCard tool={msg.tool} />;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-zinc-700 px-3.5 py-2 text-sm whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.role === "thinking") {
    return (
      <div className="px-1 text-xs italic text-zinc-500 whitespace-pre-wrap">{msg.text}</div>
    );
  }

  if (msg.role === "summary") {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-zinc-500">
        <div className="h-px flex-1 bg-zinc-800" />
        <span>{msg.text || "context compacted"}</span>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>
    );
  }

  // assistant
  return (
    <div className="text-sm leading-relaxed">
      <Markdown text={msg.text} />
      {(msg.model || msg.durationMs) && (
        <div className="mt-1 text-[11px] text-zinc-600">
          {msg.model}
          {msg.model && msg.durationMs ? " · " : ""}
          {msg.durationMs ? `${(msg.durationMs / 1000).toFixed(1)}s` : ""}
        </div>
      )}
    </div>
  );
}
