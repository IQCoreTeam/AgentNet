import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Cli, ImageInput } from "../transport/protocol";

const MODELS: Record<Cli, { value: string; label: string }[]> = {
  claude: [
    { value: "default", label: "default" },
    { value: "opus", label: "opus" },
    { value: "sonnet", label: "sonnet" },
  ],
  codex: [{ value: "default", label: "default" }],
};

const EFFORTS = [
  { value: "default", label: "default" },
  { value: "low",    label: "low" },
  { value: "medium", label: "medium" },
  { value: "high",   label: "high" },
  { value: "xhigh",  label: "x-high" },
  { value: "max",    label: "max" },
];

const MODES: Record<Cli, { value: string; label: string; title: string }[]> = {
  claude: [
    { value: "acceptEdits", label: "Auto edit",  title: "Auto-accept file edits; still ask for other tools" },
    { value: "default",     label: "Ask edits",  title: "Ask before each file edit (default)" },
    { value: "plan",        label: "Plan",        title: "Plan mode: read-only until you approve the plan" },
  ],
  codex: [
    { value: "auto",     label: "Auto accept", title: "Auto-accept edits + run inside the workspace (default)" },
    { value: "readonly", label: "Read only",   title: "Read-only sandbox; ask before edits, commands, network" },
    { value: "full",     label: "Full access", title: "Full disk + network access, never ask (use with care)" },
  ],
};

// Slash commands handled locally in this surface (not forwarded to the agent).
const SLASH_CMDS: { name: string; desc: string }[] = [
  { name: "new",    desc: "start a fresh session" },
  { name: "clear",  desc: "clear on-screen log" },
  { name: "engine", desc: "switch engine — claude|codex" },
  { name: "model",  desc: "change model" },
  { name: "effort", desc: "set reasoning effort" },
  { name: "help",   desc: "list commands" },
];

// Input + engine tabs + model/effort pickers. FROZEN while an approval is pending.
export function Composer() {
  const { state, send } = useStore();
  const [text, setText] = useState("");
  const [effort, setEffort] = useState("default");
  const [modeByCli, setModeByCli] = useState<Record<string, string>>({
    claude: "acceptEdits",
    codex: "auto",
  });
  const mode = modeByCli[state.cli] ?? MODES[state.cli][0].value;
  function changeMode(v: string) {
    setModeByCli((prev) => ({ ...prev, [state.cli]: v }));
    send({ type: "mode", mode: v });
  }
  const [attached, setAttached] = useState<(ImageInput & { dataUrl: string })[]>([]);
  const [slashNotice, setSlashNotice] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = state.typing;
  const frozen = state.approvals.length > 0;

  function encodeFile(file: File): Promise<ImageInput & { dataUrl: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const comma = dataUrl.indexOf(",");
        if (comma < 0) { reject(new Error("bad dataUrl")); return; }
        resolve({ mime: file.type || "image/png", dataBase64: dataUrl.slice(comma + 1), name: file.name, dataUrl });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const encoded = await Promise.all(arr.map(encodeFile));
    setAttached((a) => [...a, ...encoded]);
  }

  function removeAttached(i: number) {
    setAttached((a) => a.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (frozen || busy) return;
    const t = text.trim();
    if (!t && !attached.length) return;

    // slash command handling
    if (t.startsWith("/")) {
      const [cmd, ...rest] = t.slice(1).split(" ");
      const arg = rest.join(" ").trim();
      switch (cmd) {
        case "new":
          send({ type: "new" });
          setText(""); return;
        case "clear":
          // can't clear the log from here; dispatch a "new" which triggers a clear paint
          send({ type: "new" });
          setText(""); return;
        case "copy": {
          const lastAsst = [...state.log].reverse().find((m) => m.role === "assistant");
          if (lastAsst && navigator.clipboard) void navigator.clipboard.writeText(lastAsst.text);
          setText(""); return;
        }
        case "engine":
          if (arg === "claude" || arg === "codex") send({ type: "platform", cli: arg });
          setText(""); return;
        case "model":
          if (arg) send({ type: "model", model: arg });
          setText(""); return;
        case "mode":
          if (arg) changeMode(arg);
          setText(""); return;
        case "effort":
          if (arg) { setEffort(arg); send({ type: "effort", effort: arg === "default" ? undefined : arg }); }
          setText(""); return;
        case "help": {
          const lines = [...SLASH_CMDS, { name: "copy", desc: "copy last reply to clipboard" }, { name: "mode", desc: "set permission mode" }]
            .map((c) => `/${c.name} — ${c.desc}`).join("\n");
          setSlashNotice(lines);
          setText(""); return;
        }
        default:
          setSlashNotice(`Unknown command: /${cmd} — type /help for the list`);
          setText(""); return;
      }
    }

    const images = attached.map(({ mime, dataBase64, name }) => ({ mime, dataBase64, name }));
    send({ type: "send", text: t, images: images.length ? images : undefined });
    setText("");
    setAttached([]);
    setSlashNotice(null);
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function interrupt() {
    send({ type: "interrupt" });
  }

  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      interrupt();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  // paste: capture image items, fall through to default text paste otherwise
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items || []);
    const imgFiles = items.filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean) as File[];
    if (imgFiles.length) {
      e.preventDefault();
      void addFiles(imgFiles);
    }
    // non-image pastes fall through to default textarea behaviour
  }

  return (
    <div
      className="border-t border-zinc-800 px-3 pt-2"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      {/* engine tabs + model/effort pickers */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
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
          value={MODELS[state.cli].map((m) => m.value).includes(state.cli) ? state.cli : "default"}
          onChange={(e) => send({ type: "model", model: e.target.value === "default" ? undefined : e.target.value })}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300"
        >
          {MODELS[state.cli].map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          value={effort}
          onChange={(e) => {
            const v = e.target.value;
            setEffort(v);
            send({ type: "effort", effort: v === "default" ? undefined : v });
          }}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300"
          title="Reasoning effort"
        >
          {EFFORTS.map((e) => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
        <select
          value={mode}
          onChange={(e) => changeMode(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300"
          title="Permission mode: how tools run before asking you"
        >
          {MODES[state.cli].map((m) => (
            <option key={m.value} value={m.value} title={m.title}>{m.label}</option>
          ))}
        </select>
        {/* context token meter — populated by store.contextTokens */}
        {state.contextTokens !== undefined && (
          <span className="ml-auto text-zinc-500">
            ctx: {state.contextTokens >= 1000 ? Math.round(state.contextTokens / 1000) + "k" : state.contextTokens}
          </span>
        )}
      </div>

      {/* attached image thumbnails */}
      {attached.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attached.map((img, i) => (
            <div key={i} className="relative">
              <img src={img.dataUrl} alt={img.name ?? "attachment"} className="h-14 w-14 rounded object-cover border border-zinc-700" />
              <button
                onClick={() => removeAttached(i)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-[10px] text-zinc-200 hover:bg-zinc-500"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* slash command notice */}
      {slashNotice && (
        <pre className="mb-1.5 whitespace-pre-wrap rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
          {slashNotice}
          <button onClick={() => setSlashNotice(null)} className="ml-2 text-zinc-600 hover:text-zinc-400">✕</button>
        </pre>
      )}

      <div
        className={`flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 ${
          frozen ? "opacity-60" : ""
        }`}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) void addFiles(e.dataTransfer.files); }}
      >
        {/* paperclip attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={frozen}
          className="shrink-0 self-end text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
          title="Attach image"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}
        />

        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={frozen}
          onChange={(e) => { setText(e.target.value); autoGrow(e.target); }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            frozen
              ? "Answer the approval above to continue…"
              : busy
                ? `Message ${state.cli}… (Esc to stop)`
                : `Message ${state.cli}… (Enter · paste image)`
          }
          className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-relaxed outline-none [overflow-wrap:anywhere] disabled:cursor-not-allowed"
        />
        <button
          onClick={busy ? interrupt : submit}
          disabled={!busy && frozen}
          className={`shrink-0 self-end rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
            busy
              ? "bg-red-600 text-white"
              : "bg-zinc-200 text-zinc-900"
          }`}
        >
          {busy ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  );
}
