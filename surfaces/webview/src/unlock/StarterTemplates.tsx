import { useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { SCANLINES } from "./UnlockProvider";
import { haptics } from "../haptics";

// Shown once, right after a brand-new (wallet-less) user connects an engine in the Welcome
// tutorial: a "pick your first build" nudge. Choosing a template collects a couple of inputs
// and, on Confirm, opens a NEW chat session with a prewritten prompt so the agent starts
// building immediately. "Just start" or the [x] skip it. Persisted so it appears only once.
const SEEN_KEY = "agentnet.templatesSeen";
const templatesSeen = () => localStorage.getItem(SEEN_KEY) === "1";
const markTemplatesSeen = () => localStorage.setItem(SEEN_KEY, "1");

// ── Template config: ONE place to edit the copy and the prompt each template sends. ──
// buildPrompt fills {{...}} from the collected field values. Add a template = add an entry.
type TemplateField = {
  key: string;
  label: string;
  placeholder: string;
  kind: "text" | "textarea" | "choice";
  choices?: { value: string; label: string; hint: string }[];
};
type StarterTemplate = {
  id: string;
  seq: string; // header "TEMPLATE xx/yy"
  titleBar: string;
  eyebrow: string;
  title: ReactNode;
  body: string;
  caption: string;
  menuLabel: string; // picker row
  menuSub: string;
  fields: TemplateField[];
  buildPrompt: (v: Record<string, string>) => string;
};

const GAME_RULES: Record<string, string> = {
  tap: "tap as fast as possible before the timer runs out to score",
  puzzle: "match or clear blocks to score, with simple rules",
  reflex: "tap exactly when the on-screen target aligns, timing based",
};

const TEMPLATES: StarterTemplate[] = [
  {
    id: "aboutme",
    seq: "01/02",
    titleBar: "About_Me_Page",
    eyebrow: "ABOUT_ME",
    title: <>A one-page site<br />about you</>,
    body: "All it takes: one public link the agent can read, plus a short intro.",
    caption: "Confirm sends this into the chat, and the agent reads your link and starts building the page.",
    menuLabel: "01_ABOUT_ME_PAGE",
    menuSub: "A one-page site introducing you",
    fields: [
      { key: "WORK_LINK", label: "YOUR_WORK_LINK", kind: "text", placeholder: "https:// a public link to your work (drive, github, blog)" },
      { key: "ABOUT_YOU", label: "ABOUT_YOU", kind: "textarea", placeholder: "e.g. I love taking photos and live with two cats. Currently starting a cooking channel." },
    ],
    buildPrompt: (v) => `Build a clean, single-page personal website about me, then run it locally and give me the preview link.

About me:
${v.ABOUT_YOU?.trim() || "(no intro given, ask me for one line if you need it)"}

My work link: ${v.WORK_LINK?.trim() || "(none given)"}

Steps:
1. If a work link is given and reachable, read it (use curl or a fetch tool) and pull real, specific details from it: projects, photos, writing style, links. If it cannot be read (private or blocked), tell me and build from the intro alone.
2. Design a modern, responsive, mobile-first page. Lead with a short hero built from my intro, then a section that reflects what you found at the link.
3. Keep it to one self-contained page. Serve it on a local port and give me the http://localhost preview link.
Only ask a question if something truly blocks you. Otherwise just build it.`,
  },
  {
    id: "game",
    seq: "02/02",
    titleBar: "Mini_Game",
    eyebrow: "MINI_GAME",
    title: <>A mini game<br />of your own</>,
    body: "Pick a type and name a hero. The agent handles the rest.",
    caption: "Confirm sends this into the chat, and the agent starts building the game.",
    menuLabel: "02_MINI_GAME",
    menuSub: "A simple tap-to-play game of your own",
    fields: [
      {
        key: "GAME_TYPE",
        label: "GAME_TYPE",
        kind: "choice",
        placeholder: "",
        choices: [
          { value: "tap", label: "Tap game", hint: "tap fast to score" },
          { value: "puzzle", label: "Puzzle", hint: "match blocks to clear" },
          { value: "reflex", label: "Reflex", hint: "tap right on time" },
        ],
      },
      { key: "HERO_OR_THEME", label: "HERO_OR_THEME", kind: "text", placeholder: "e.g. a cat running while eating kimbap" },
    ],
    buildPrompt: (v) => {
      const type = v.GAME_TYPE || "tap";
      return `Build a small ${type} game I can play on my phone, then run it locally and give me the preview link.

Theme or hero: ${v.HERO_OR_THEME?.trim() || "(your choice, pick something fun)"}

Requirements:
1. One self-contained web page (HTML, CSS, JS), mobile-first, portrait, touch controls.
2. Game feel: ${GAME_RULES[type]}.
3. Show a score, a start screen, and a restart button. Keep it lightweight and responsive.
4. Serve it on a local port and give me the http://localhost preview link.
Just build it. Only ask a question if something truly blocks you.`;
    },
  },
];

export function StarterTemplates() {
  const { state, send } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const [pickId, setPickId] = useState<string | null>(null); // null = picker; else the input screen
  const [values, setValues] = useState<Record<string, string>>({});

  const engineConnected = !!state.cliReport && (state.cliReport.claude === "ok" || state.cliReport.codex === "ok");
  // Only for a fresh explorer: engine on, no wallet yet, the Welcome intro already finished (so
  // this never overlaps it), and not seen before.
  const welcomeDone = localStorage.getItem("agentnet.welcomeSeen") === "1";
  const show = state.phase === "chat" && engineConnected && !state.walletAddress && welcomeDone && !templatesSeen() && !dismissed;
  if (!show) return null;

  const tpl = TEMPLATES.find((t) => t.id === pickId) ?? null;

  function closeForNow() {
    haptics.tap();
    setDismissed(true); // this run only; returns next launch until a template is used or skipped
  }
  function justStart() {
    markTemplatesSeen();
    setDismissed(true);
  }
  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }
  function confirm() {
    if (!tpl) return;
    const prompt = tpl.buildPrompt(values);
    haptics.step1();
    markTemplatesSeen();
    setDismissed(true);
    // Open a fresh session, then send the prewritten prompt as its first message. The small
    // delay lets the "new" land first so the prompt attaches to the new session, not the old.
    send({ type: "new" });
    window.setTimeout(() => send({ type: "send", text: prompt }), 350);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Starter templates">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close templates" onClick={closeForNow} />
      <section className="an-term-mono unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)] text-[color:var(--an-fg)]">
        <div className="border-b border-[color:var(--an-line)]">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
            <span>&gt;{tpl ? `TEMPLATE ${tpl.seq}` : "ENGINE_CONNECTED"}</span><span>ようこそ {tpl ? "******" : "OK"}</span>
          </div>
          <div className="mx-3 mb-3 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "9px 12px" }}>
            <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.14em]">{tpl ? tpl.titleBar : "Welcome_Aboard"}</h2>
            <button type="button" onClick={closeForNow} className="shrink-0 text-[13px] font-bold leading-none active:opacity-70" aria-label="Close">[x]</button>
          </div>
        </div>

        <div key={pickId ?? "picker"} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!tpl ? (
            // ── Picker (Welcome 05): pick your first build ──
            <div className="mx-auto max-w-[340px] text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-green)]">&gt;READY<span className="unlock-cursor">_</span></p>
              <h3 className="mt-3 text-[19px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-[color:var(--an-fg)]">Start from<br />a template</h3>
              <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-[1.65] text-[color:var(--an-fg-dim)]">Engine connected. Pick your first build.</p>
              <div className="mt-4 flex flex-col gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { haptics.tap(); setPickId(t.id); }}
                    className="flex items-center gap-2 border px-3 py-3 text-left active:opacity-80"
                    style={{ borderColor: "var(--an-green-line)", background: "var(--an-green-dim)" }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--an-green)]">&gt;{t.menuLabel}</span>
                      <span className="truncate text-[11px] text-[color:var(--an-fg-dim)]">{t.menuSub}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-bold text-[color:var(--an-green)]">[&gt;]</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={justStart} className="an-btn an-btn-outline mt-3 w-full">Just start</button>
            </div>
          ) : (
            // ── Template input screen ──
            <div className="mx-auto max-w-[340px]">
              <p className="text-center text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-green)]">&gt;{tpl.eyebrow}<span className="unlock-cursor">_</span></p>
              <h3 className="mt-3 text-center text-[19px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-[color:var(--an-fg)]">{tpl.title}</h3>
              <p className="mx-auto mt-2 max-w-[290px] text-center text-[13px] leading-[1.6] text-[color:var(--an-fg-dim)]">{tpl.body}</p>

              <div className="mt-5 flex flex-col gap-4">
                {tpl.fields.map((f) => (
                  <div key={f.key}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--an-green)]">&gt;{f.label}</p>
                    {f.kind === "choice" ? (
                      <div className="mt-2 flex gap-1.5">
                        {f.choices!.map((c) => {
                          const on = values[f.key] === c.value;
                          return (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => { haptics.tap(); set(f.key, c.value); }}
                              className="flex-1 border px-1 py-2 text-center"
                              style={on
                                ? { borderColor: "var(--an-green-line)", background: "var(--an-green-dim)", color: "var(--an-green)" }
                                : { borderColor: "var(--an-line)", color: "var(--an-fg-dim)" }}
                            >
                              <span className="block text-[11px] font-bold uppercase">{c.label}</span>
                              <span className="mt-1 block text-[8px] leading-tight" style={{ color: on ? "var(--an-green)" : "var(--an-fg-mute)" }}>{c.hint}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : f.kind === "textarea" ? (
                      <textarea
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        rows={3}
                        className="an-term-ta mt-2 w-full resize-none border px-3 py-2.5 text-[12px] leading-relaxed outline-none"
                        style={{ borderColor: "var(--an-line)", background: "var(--an-bg-2)", color: "var(--an-fg)" }}
                      />
                    ) : (
                      <input
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="mt-2 w-full border px-3 py-2.5 text-[12px] outline-none"
                        style={{ borderColor: "var(--an-line)", background: "var(--an-bg-2)", color: "var(--an-fg)" }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <button type="button" onClick={confirm} className="an-btn an-btn-green mt-5 w-full">Confirm</button>
              <button type="button" onClick={() => { haptics.tap(); setPickId(null); }} className="welcome-ghost mt-1">Back</button>
              <p className="mx-auto mt-2 max-w-[290px] text-center text-[11px] leading-[1.6] text-[color:var(--an-fg-mute)]">{tpl.caption}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
