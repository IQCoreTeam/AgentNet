import { useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Cli } from "../transport/protocol";

const MODELS: Record<Cli, { value: string; label: string }[]> = {
  claude: [
    { value: "default", label: "default" },
    { value: "opus", label: "opus" },
    { value: "sonnet", label: "sonnet" },
  ],
  codex: [{ value: "default", label: "default" }],
};

// Input + engine tabs + model picker. FROZEN while an approval is pending: the textarea
// keeps its value (only disabled is toggled, never the text), so a half-typed message
// survives the wait — same contract as the vscode webview fix.
export function Composer() {
  const { state, send } = useStore();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const frozen = state.approvals.length > 0;

  function submit() {
    if (frozen) return;
    const t = text.trim();
    if (!t) return;
    send({ type: "send", text: t });
    setText("");
  }

  return (
    <div
      className="border-t border-zinc-800 px-3 pt-2"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <div className="flex gap-1">
          {(["claude", "codex"] as Cli[]).map((c) => (
            <button
              key={c}
              onClick={() => send({ type: "platform", cli: c })}
              className={`rounded px-2 py-0.5 ${
                state.cli === c
                  ? c === "claude"
                    ? "bg-orange-600/30 text-orange-300"
                    : "bg-emerald-600/30 text-emerald-300"
                  : "text-zinc-500"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <select
          onChange={(e) =>
            send({ type: "model", model: e.target.value === "default" ? undefined : e.target.value })
          }
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300"
        >
          {MODELS[state.cli].map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div
        className={`flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 ${
          frozen ? "opacity-60" : ""
        }`}
      >
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={frozen}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return; // mid-IME (Korean/JP/CN)
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            frozen
              ? "Answer the approval above to continue…"
              : `Message ${state.cli}… (Enter to send)`
          }
          className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none disabled:cursor-not-allowed"
        />
        <button
          onClick={submit}
          disabled={frozen}
          className="rounded-lg bg-zinc-200 px-3 py-1 text-sm font-medium text-zinc-900 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
