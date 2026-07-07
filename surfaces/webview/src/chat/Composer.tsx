import { useEffect, useRef, useState } from "react";
import { useStore, isApprovalForView } from "../state/store";
import { enqueueLiveImages } from "./liveImages";
import type { Cli, ImageInput } from "../transport/protocol";
import { AttachIcon } from "../icons";
import { haptics } from "../haptics";
import { useElementHeightVariable } from "../layoutEffects";
import type { ChatModelOption } from "@iqlabs-official/agent-sdk/chat/modelOptions";
import { CHAT_SLASH_COMMANDS } from "@iqlabs-official/agent-sdk/chat/slashCommands";

// ── Context dot (compact donut circle for mobile, mirrors Claude Code's meter) ──
// Colors: green < 60 %, amber < 85 %, red ≥ 85 %. Orange pulse while compacting.
function CtxDot({ tokens, window: win, compacting }: { tokens: number; window: number; compacting?: boolean }) {
  const frac = Math.min(1, tokens / win);
  const pct = Math.round(frac * 100);
  const color = compacting
    ? "var(--an-orange, #f80)"
    : frac >= 0.85 ? "var(--an-red, #e55)" : frac >= 0.60 ? "var(--an-amber, #e90)" : "var(--an-orange, #f80)";
  const r = 7;
  const circ = 2 * Math.PI * r;
  const fmtK = (n: number) => n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
  return (
    <span
      className="ml-auto flex items-center"
      title={compacting ? "Compacting context…" : `Context: ${tokens.toLocaleString()} / ${win.toLocaleString()} tokens (${pct}%)\n${fmtK(tokens)} / ${fmtK(win)} ctx`}
      style={{ cursor: "default" }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block" }}>
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--an-line, #333)" strokeWidth="2.5" />
        <circle
          cx="9" cy="9" r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={compacting ? `${circ * 0.75} ${circ * 0.25}` : `${frac * circ} ${(1 - frac) * circ}`}
          strokeLinecap="round"
          transform={compacting ? undefined : "rotate(-90 9 9)"}
          style={compacting ? { transformBox: "fill-box", transformOrigin: "center", animation: "ctxspin 1s linear infinite" } : undefined}
        />
      </svg>
      {compacting && <style>{`@keyframes ctxspin { from { transform: rotate(-90deg); } to { transform: rotate(270deg); } }`}</style>}
    </span>
  );
}

// Map the shared model catalog (state.modelCatalog — static baseline, upgraded live from
// the installed CLI) into the picker's {value,label,desc} rows. No bare "default": the
// first real model is the default, shown by its actual name (Opus 4.8, GPT-5.5 Codex…).
type ModelRow = { value: string; label: string; desc: string };
function toModelRows(opts: readonly ChatModelOption[]): ModelRow[] {
  return opts.map((o) => ({ value: o.value ?? "default", label: o.chipLabel, desc: o.description }));
}

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

function slashCommandsForCli(cli: Cli): { name: string; desc: string; insert: string }[] {
  return CHAT_SLASH_COMMANDS
    .filter((cmd) => cmd.engines.includes(cli))
    .map((cmd) => ({
      name: cmd.name,
      desc: cmd.desc,
      insert: "/" + cmd.name + (cmd.args ? " " : ""),
    }));
}

// A labelled row of tappable chips — the mobile replacement for a native <select>.
// One chip is active (accent fill); tapping another picks it. Used for model/effort/mode.
function ChipGroup({ label, value, options, onPick, accent = "green" }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
  accent?: "green" | "orange";
}) {
  const acc = accent === "orange"
    ? { color: "#f0913e", border: "1px solid #6b4a22", background: "#1a0f06" }
    : { color: "#4ade80", border: "1px solid #2f6b46", background: "#0d160f" };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="an-term-mono text-[9px] font-bold uppercase" style={{ color: "#6a6a6a", letterSpacing: "2px" }}>{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onPick(o.value)}
              className="an-term-mono text-[11px] font-bold uppercase tracking-wide transition"
              style={on ? { ...acc, padding: "8px 14px" } : { color: "#8a8a8a", border: "1px solid #2a2a2e", padding: "8px 14px" }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Input + engine tabs + model/effort pickers. FROZEN while an approval is pending.
export function Composer() {
  const { state, send, selectEngine, queueCount, markCompacting } = useStore();
  const [text, setText] = useState("");
  const [effort, setEffort] = useState("default");
  const [model, setModel] = useState("default");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const mode = state.modeByCli[state.cli] ?? MODES[state.cli][0].value;
  // live model rows for the active engine (upgraded from the CLI). selectedModel falls to
  // the first real model when `model` isn't in the list (initial, or after a live upgrade).
  const models = toModelRows(state.modelCatalog[state.cli]);
  const selectedModel = models.some((m) => m.value === model) ? model : (models[0]?.value ?? "default");
  // The active engine tints the composer border (claude = orange, codex = green) so the
  // input itself shows which platform you're talking to — vscode's folder-tab idea.
  const engineAccent = state.cli === "claude" ? "var(--claude)" : "var(--an-green)";

  // Voice dictation via the platform Web Speech API (Android WebView / Chrome support it).
  // Interim results stream into the textarea; a second tap stops. Silent no-op if absent.
  function toggleMic() {
    if (recording) { recognitionRef.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSlashNotice("Voice input isn't available on this device."); return; }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    const base = text ? text + " " : "";
    rec.onresult = (e: any) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(base + s);
    };
    // No taRef.focus() here: focusing the textarea flips html[data-keyboard=open], which hides
    // the bottom tab bar — dictation shouldn't trigger keyboard chrome. Text lands without it.
    rec.onend = () => { setRecording(false); recognitionRef.current = null; };
    rec.onerror = () => { setRecording(false); recognitionRef.current = null; };
    recognitionRef.current = rec;
    setRecording(true);
    rec.start();
  }
  function changeMode(v: string) {
    send({ type: "mode", mode: v });
  }
  const [attached, setAttached] = useState<(ImageInput & { dataUrl: string })[]>([]);
  const [slashNotice, setSlashNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const busy = state.typing;
  // Freeze only for an approval in THIS chat — a backgrounded session's pending approval
  // pings a notification instead, it must not lock the composer of the chat you're in.
  const frozen = state.approvals.some((a) => isApprovalForView(a, state.activeSessionId));

  const [slashIdx, setSlashIdx] = useState(0);
  const [suppressSlash, setSuppressSlash] = useState(false);
  useElementHeightVariable(rootRef, "--composer-height");
  // Just the input box height — lets the jump-to-latest button sit right above it.
  useElementHeightVariable(inputBoxRef, "--composer-input-height");

  // Derived state: active slash matches
  let activeMatches: { name: string; desc: string; insert: string }[] = [];
  let subCmd: string | null = null;
  if (!suppressSlash) {
    // 1. Engine options
    let m = /^\/engine(?:\s+(\S*))?$/.exec(text);
    if (m) {
      subCmd = 'engine';
      const prefix = (m[1] || '').toLowerCase();
      const options = [
        { name: 'claude', desc: 'switch to Claude engine', insert: '/engine claude' },
        { name: 'codex',  desc: 'switch to Codex engine',  insert: '/engine codex' }
      ];
      activeMatches = options.filter(opt => opt.name.toLowerCase().startsWith(prefix));
    }
    // 2. Model options
    if (!subCmd) {
      m = /^\/model(?:\s+(\S*))?$/.exec(text);
      if (m) {
        subCmd = 'model';
        const prefix = (m[1] || '').toLowerCase();
        const options = models.map(o => ({ name: o.value, desc: o.label, insert: '/model ' + o.value }));
        activeMatches = options.filter(opt => opt.name.toLowerCase().startsWith(prefix));
      }
    }
    // 3. Mode options
    if (!subCmd) {
      m = /^\/mode(?:\s+(\S*))?$/.exec(text);
      if (m) {
        subCmd = 'mode';
        const prefix = (m[1] || '').toLowerCase();
        const list = MODES[state.cli] || [];
        const options = list.map(o => ({ name: o.value, desc: o.label + ' - ' + o.title, insert: '/mode ' + o.value }));
        activeMatches = options.filter(opt => opt.name.toLowerCase().startsWith(prefix));
      }
    }
    // 4. Effort options
    if (!subCmd) {
      m = /^\/effort(?:\s+(\S*))?$/.exec(text);
      if (m) {
        subCmd = 'effort';
        const prefix = (m[1] || '').toLowerCase();
        const options = EFFORTS.map(o => ({ name: o.value, desc: o.label, insert: '/effort ' + o.value }));
        activeMatches = options.filter(opt => opt.name.toLowerCase().startsWith(prefix));
      }
    }
    // 5. Main options
    if (!subCmd) {
      m = /^\/(\S*)$/.exec(text);
      if (m) {
        const prefix = m[1].toLowerCase();
        const options = slashCommandsForCli(state.cli);
        activeMatches = options.filter(opt => opt.name.toLowerCase().startsWith(prefix));
      }
    }
  }

  // If the user fully typed the sub-command argument, hide the menu
  const isFullyTyped = !!(subCmd && activeMatches.length === 1 && activeMatches[0].name.toLowerCase() === (text.split(/\s+/)[1] || '').toLowerCase());
  const showMenu = activeMatches.length > 0 && !isFullyTyped;

  function completeSlash(c: { name: string; desc: string; insert: string }) {
    setText(c.insert);
    setSuppressSlash(false);
    setSlashIdx(0);
    if (taRef.current) {
      taRef.current.focus();
      // Auto-grow height immediately
      setTimeout(() => {
        if (taRef.current) {
          taRef.current.style.height = "auto";
          taRef.current.style.height = `${taRef.current.scrollHeight}px`;
        }
      }, 0);
    }
  }

  // Outside click listener
  useEffect(() => {
    if (!showMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (taRef.current && !taRef.current.parentElement?.contains(e.target as Node)) {
        setSuppressSlash(true);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [showMenu]);

  // Sniff the real image type from the first bytes. Android's photo picker hands the WebView
  // File objects with a blank MIME (file.type === ""), so trusting it would drop every pick
  // and reject every send. We detect the type from magic bytes instead.
  function sniffImageMime(bytes: Uint8Array): string | null {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
  }

  function encodeFile(file: File): Promise<ImageInput & { dataUrl: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const comma = dataUrl.indexOf(",");
        if (comma < 0) { reject(new Error("bad dataUrl")); return; }
        const dataBase64 = dataUrl.slice(comma + 1);
        // Decode the head (~18 bytes from 24 base64 chars) to identify the format.
        const head = atob(dataBase64.slice(0, 24));
        const bytes = new Uint8Array(head.length);
        for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
        const mime = file.type && file.type.startsWith("image/") ? file.type : sniffImageMime(bytes);
        if (!mime) { reject(new Error("not an image")); return; }
        // Rebuild the dataUrl with the resolved mime so the thumbnail renders even when the
        // browser left it blank (data:;base64 won't display).
        resolve({ mime, dataBase64, name: file.name || "image", dataUrl: `data:${mime};base64,${dataBase64}` });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files: FileList | File[]) {
    // Don't pre-filter on file.type (blank from the Android picker). Encode everything and let
    // encodeFile sniff the real type, dropping anything that isn't a supported image.
    const encoded = (await Promise.all(
      Array.from(files).map((f) => encodeFile(f).catch(() => null)),
    )).filter((x): x is ImageInput & { dataUrl: string } => x !== null);
    if (!encoded.length) return;
    setAttached((a) => [...a, ...encoded]);
    requestAnimationFrame(() => taRef.current?.scrollIntoView({ block: "nearest" }));
  }

  function removeAttached(i: number) {
    setAttached((a) => a.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (frozen) return;
    const t = text.trim();
    if (!t && !attached.length) return;
    haptics.tap(); // a real dispatch is happening; an empty tap above stayed silent

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
          if (arg === "claude" || arg === "codex") selectEngine(arg);
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
        case "login": {
          const target = arg === "claude" || arg === "codex" ? arg : state.cli;
          if (target === "claude" && arg && arg !== "claude" && arg !== "codex") send({ type: "claudeAuthCode", code: arg });
          else send({ type: target === "claude" ? "startClaudeLogin" : "startCodexLogin" });
          setText(""); return;
        }
        case "logout": {
          const target = arg === "claude" || arg === "codex" ? arg : state.cli;
          send({ type: "logoutEngine", cli: target });
          setText(""); return;
        }
        case "help": {
          const lines = slashCommandsForCli(state.cli)
            .map((c) => `/${c.name} — ${c.desc}`).join("\n");
          setSlashNotice(lines);
          setText(""); return;
        }
        default:
          if (cmd === "compact") markCompacting();
          send({ type: "slashCommand", command: cmd, arg: arg || undefined });
          setText(""); return;
      }
    }

    const images = attached.map(({ mime, dataBase64, name }) => ({ mime, dataBase64, name }));
    // Hand the previews to the live cache before clearing: the chat log only keeps a count,
    // so this in-memory copy is what renders thumbnails for this turn while it's on screen.
    if (attached.length) enqueueLiveImages(attached.map((a) => a.dataUrl));
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
      ref={rootRef}
      className="an-composer-float px-2.5 pt-2"
    >
      {/* engine segmented control + a single "controls" disclosure (model/effort/mode
          live in the popover so the bar stays clean on a phone) */}
      <div className="relative mb-2 flex items-center gap-1.5 text-xs">
        <div className="an-term-seg">
          {(["claude", "codex"] as Cli[]).map((c) => {
            const on = state.cli === c;
            const accent = c === "claude" ? "var(--claude)" : "var(--an-green)";
            return (
              <button
                key={c}
                onClick={() => selectEngine(c)}
                style={on ? { background: accent, color: "var(--an-bg-0)" } : undefined}
              >
                {c}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setControlsOpen((o) => !o)}
          className="an-term-chip shrink-0"
          aria-label="Model and mode settings"
          aria-expanded={controlsOpen}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /><circle cx="6" cy="4.5" r="1.5" fill="var(--an-bg-2)" /><circle cx="10.5" cy="8" r="1.5" fill="var(--an-bg-2)" /><circle cx="6" cy="11.5" r="1.5" fill="var(--an-bg-2)" />
          </svg>
          <span className="max-w-[7rem] truncate">{MODES[state.cli].find((m) => m.value === mode)?.label ?? mode}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ transform: controlsOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M2.5 4l2.5 2.5L7.5 4" /></svg>
        </button>
        {(state.contextTokens !== undefined || state.isCompacting) && (() => {
          const tokens = state.contextTokens ?? 0;
          const win = state.contextWindow ?? (state.cli === "codex" ? 256_000 : 200_000);
          return <CtxDot tokens={tokens} window={win} compacting={state.isCompacting} />;
        })()}
        {queueCount > 0 && (
          <span className="ml-auto animate-pulse text-[10px]" style={{ color: "var(--an-amber)" }}>
            ⏳ {queueCount} queued
          </span>
        )}

        {controlsOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setControlsOpen(false)} />
            <div
              className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-50 flex flex-col gap-5 p-4 shadow-2xl"
              style={{ background: "#0a0a0b", border: "1px solid #2a2a2e" }}
            >
              <div className="flex flex-col gap-2.5">
                <ChipGroup
                  label="Model"
                  value={selectedModel}
                  options={models.map((m) => ({ value: m.value, label: m.label }))}
                  onPick={(v) => { setModel(v); send({ type: "model", model: v === "default" ? undefined : v }); }}
                />
                {/* version/detail of the selected model, from the shared catalog */}
                <p className="an-term-mono text-[9px] uppercase leading-snug" style={{ color: "#5a5a5d", letterSpacing: "0.5px" }}>
                  {models.find((m) => m.value === selectedModel)?.desc}
                </p>
              </div>
              <ChipGroup
                label="Effort"
                value={effort}
                options={EFFORTS}
                onPick={(v) => { setEffort(v); send({ type: "effort", effort: v === "default" ? undefined : v }); }}
              />
              <ChipGroup
                label="Mode"
                value={mode}
                accent="orange"
                options={MODES[state.cli].map((m) => ({ value: m.value, label: m.label }))}
                onPick={(v) => changeMode(v)}
              />
            </div>
          </>
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
        ref={inputBoxRef}
        className={`an-composer-input relative flex items-center gap-1.5 px-2 ${frozen ? "opacity-60" : ""}`}
        style={{ minHeight: "56px", ...(state.isCompacting ? { "--tk": "#f80", borderColor: "#f80" } as React.CSSProperties : {}) }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) void addFiles(e.dataTransfer.files); }}
      >
        {showMenu && (
          <div
            className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-50 flex flex-col gap-0.5 overflow-y-auto p-1 shadow-2xl"
            style={{ maxHeight: "min(12rem, max(6rem, calc(var(--vvh, 100dvh) * 0.35)))", background: "var(--an-bg-1)", border: "1px solid var(--an-line)", borderRadius: "var(--an-radius-sm)" }}
          >
            {activeMatches.map((cmd, idx) => {
              const isSel = idx === slashIdx;
              const label = subCmd ? cmd.name : '/' + cmd.name;
              return (
                <button
                  key={cmd.name}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    completeSlash(cmd);
                  }}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    isSel
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="font-semibold text-zinc-200">{label}</span>
                  <span className="opacity-60 text-[10px] truncate">{cmd.desc}</span>
                </button>
              );
            })}
            <div className="border-t border-zinc-900 mt-1 px-2 pt-1.5 pb-0.5 text-[9px] text-zinc-600 select-none">
              Use ↑↓ to navigate, Tab/Enter to select, Esc to close
            </div>
          </div>
        )}
        {/* paperclip attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={frozen}
          className="flex h-10 w-9 shrink-0 items-center justify-center disabled:opacity-40"
          style={{ color: "var(--an-fg-mute)" }}
          title="Attach image"
          aria-label="Attach image"
        >
          <AttachIcon className="h-5 w-5" />
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
          onChange={(e) => {
            setText(e.target.value);
            autoGrow(e.target);
            setSuppressSlash(false);
            setSlashIdx(0);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            setText(e.currentTarget.value);
          }}
          onFocus={() => {
            setTimeout(() => taRef.current?.scrollIntoView({ block: "nearest" }), 80);
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composingRef.current) return;

            if (showMenu) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIdx((slashIdx + 1) % activeMatches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIdx((slashIdx - 1 + activeMatches.length) % activeMatches.length);
                return;
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                if (activeMatches[slashIdx]) {
                  completeSlash(activeMatches[slashIdx]);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSuppressSlash(true);
                return;
              }
            }

            if (e.key === "Enter" && !e.shiftKey) {
              if (window.matchMedia("(pointer: coarse) and (not (any-pointer: fine))").matches) return;
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            frozen
              ? "Answer the approval above to continue…"
              : busy && queueCount > 0
                ? `Queued (${queueCount}) — agent will pick up next…`
                : busy
                  ? `Message ${state.cli}… (queues while busy · Esc to stop)`
                  : state.log.length === 0
                    ? "Send a message to start"
                    : `Message ${state.cli}`
          }
          className="an-term-ta min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-[16px] leading-relaxed outline-none [overflow-wrap:anywhere] disabled:cursor-not-allowed"
          style={{ maxHeight: "min(10rem, max(4rem, calc(var(--vvh, 100dvh) * 0.28)))" }}
        />
        {/* mic: voice dictation into the textarea (red while listening) */}
        <button
          type="button"
          onClick={toggleMic}
          disabled={frozen}
          className="flex h-10 w-9 shrink-0 items-center justify-center disabled:opacity-40"
          style={{ color: recording ? "#e5484d" : "var(--an-fg-mute)" }}
          aria-label={recording ? "Stop dictation" : "Voice input"}
          title={recording ? "Stop dictation" : "Voice input"}
        >
          {recording ? (
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: "#e5484d" }} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="2" width="4" height="7" rx="2" /><path d="M4 7.5a4 4 0 0 0 8 0M8 11.5V14M6 14h4" />
            </svg>
          )}
        </button>
        <button
          onClick={busy ? interrupt : submit}
          disabled={!busy && frozen}
          className={`an-send shrink-0 ${busy ? "is-stop" : ""}`}
          style={busy ? undefined : { background: engineAccent, color: "var(--an-bg-0)" }}
          aria-label={busy ? "Stop" : "Send"}
          title={busy ? "Stop" : "Send"}
        >
          {busy ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 15V4M4.5 8.5L9 4l4.5 4.5" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}
