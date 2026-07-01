import { useEffect, useState, type CSSProperties } from "react";
import { useStore } from "../state/store";
import { ImageIcon, SkillIcon } from "../icons";

// Per-kind tint: skills forge violet, workflows forge amber (matches their card colors).
const PUBLISH_THEME = {
  skill: { noun: "skill", head: "text-purple-200", border: "border-purple-800/40", wash: "from-purple-900/25", icon: "text-purple-300", on: "bg-purple-400", onText: "text-purple-300", bar: "from-purple-500 to-purple-300", label: "text-purple-200" },
  workflow: { noun: "workflow", head: "text-amber-200", border: "border-amber-700/40", wash: "from-amber-900/25", icon: "text-amber-300", on: "bg-amber-400", onText: "text-amber-300", bar: "from-amber-500 to-amber-300", label: "text-amber-200" },
} as const;

function PublishProgressView({ progress }: { progress: { phase: "store" | "mint" | "list"; signed: number; percent?: number; kind: "skill" | "workflow" } | null }) {
  const t = PUBLISH_THEME[progress?.kind ?? "skill"];
  const phases = [
    { key: "store", label: `Storing ${t.noun} on-chain` },
    { key: "mint", label: "Minting the NFT" },
    { key: "list", label: "Listing for sale" },
  ] as const;
  const idx = progress ? Math.max(0, phases.findIndex((p) => p.key === progress.phase)) : 0;
  // Completed phases + the code-in sub-percent of the store phase fill the gauge.
  const sub = progress?.phase === "store" && progress.percent != null ? progress.percent / 100 : idx > 0 ? 1 : 0;
  const overall = Math.min(100, Math.round(((idx + sub) / phases.length) * 100));
  const signed = progress?.signed ?? 0;

  return (
    <div className="flex flex-col h-full">
      <header className={`flex items-center gap-2 border-b ${t.border} px-3 py-2 shrink-0`}>
        <span className={`font-medium text-sm ${t.head}`}>Forging your {t.noun}</span>
      </header>
      <div className={`flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center bg-gradient-to-b ${t.wash} to-transparent`}>
        <SkillIcon className={`h-12 w-12 ${t.icon} publish-forge-pulse`} />

        <div className="w-full max-w-xs space-y-3">
          {/* Phase steps */}
          <div className="flex items-center justify-between gap-1">
            {phases.map((p, i) => (
              <div key={p.key} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`h-1.5 w-full rounded-full ${i < idx ? t.on : i === idx ? `${t.on} publish-forge-pulse` : "bg-zinc-700"}`}
                />
                <span className={`text-[10px] ${i === idx ? t.onText : "text-zinc-600"}`}>{i + 1}/{phases.length}</span>
              </div>
            ))}
          </div>

          {/* Gauge */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full rounded-full bg-gradient-to-r ${t.bar} transition-[width] duration-300`} style={{ width: `${overall}%` }} />
          </div>

          <p className={`text-sm font-medium ${t.label}`}>{phases[idx].label}</p>
          <p className="text-xs text-zinc-500">
            {signed > 0 ? `${signed} signature${signed === 1 ? "" : "s"} approved` : "Waiting for the first signature…"}
          </p>
        </div>

        <p className="text-[11px] text-zinc-600 max-w-xs leading-relaxed">
          Publishing takes several wallet signatures. Approve each prompt — this can&apos;t be batched because every step builds on the previous transaction.
        </p>
      </div>
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export function PublishForm({ onBack }: Props) {
  const { send, state, clearPublishResult } = useStore();
  const [kind, setKind] = useState<"skill" | "workflow">("skill");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [priceSol, setPriceSol] = useState("0");
  const [imageUrl, setImageUrl] = useState(""); // http/on-chain link only — no file upload
  const [requiredSkills, setRequiredSkills] = useState<Record<string, boolean>>({}); // mint -> selected
  const [submitting, setSubmitting] = useState(false);

  const result = state.publishResult;
  const theme = PUBLISH_THEME[kind];

  // Belt-and-suspenders: MarketScreen already sends this on tab mount, but a future entry
  // point that skips it would otherwise leave the required-skills picker empty.
  useEffect(() => { send({ type: "ownedSkills" }); }, []);

  // A result (success OR failure) ends the in-flight state so the form/button come back.
  useEffect(() => { if (result) setSubmitting(false); }, [result]);

  const chosenSkills = Object.keys(requiredSkills).filter((m) => requiredSkills[m]);

  function handleSubmit() {
    if (!name.trim() || !text.trim()) return;
    if (kind === "workflow" && chosenSkills.length === 0) return;
    setSubmitting(true);
    clearPublishResult();
    // Image is a link ONLY (http URL or on-chain address). The app can't attach/upload a
    // file, and a link stays tiny so the body doesn't chunk on-chain (keeps signatures low).
    send({
      type: "publishSkill",
      name: name.trim(),
      description: description.trim(),
      text: text.trim(),
      category: category.trim() || undefined,
      hashtags: hashtags.split(",").map((h) => h.trim()).filter(Boolean),
      priceSol: priceSol || "0",
      image: imageUrl.trim() || undefined,
      kind,
      requiredSkills: kind === "workflow" ? chosenSkills : undefined,
    });
    setTimeout(() => setSubmitting(false), 15000);
  }

  // Only SUCCESS takes over the screen (the mint address + celebration). A FAILURE keeps
  // the form mounted and shows the error as a bubble above the button — no page bounce.
  if (result?.ok) {
    return (
      <div className="flex flex-col h-full">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
          <button onClick={() => { clearPublishResult(); onBack(); }} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
          <span className="font-medium text-sm">Publish {kind === "workflow" ? "Workflow" : "Skill"}</span>
        </header>
        <div className={`flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center bg-gradient-to-b ${theme.wash} to-transparent`}>
          <SkillIcon className={`h-10 w-10 ${theme.icon}`} />
          <p className={`${theme.onText} font-semibold`}>{kind === "workflow" ? "Workflow" : "Skill"} minted!</p>
          {result.mint && <p className="font-mono text-xs text-zinc-500">{result.mint}</p>}
          <button onClick={() => { clearPublishResult(); onBack(); }} className="mt-2 text-sm text-zinc-400 underline">Back to market</button>
        </div>
      </div>
    );
  }

  // Publishing is several wallet signatures (store the body on-chain → mint → list), and
  // the body can chunk into many. While it runs, show a forge gauge with a live signature
  // count so the repeated wallet prompts read as progress, not a glitch.
  if ((submitting || state.publishProgress) && !result) {
    return <PublishProgressView progress={state.publishProgress} />;
  }

  // The image field accepts ONLY three shapes — nothing else gets through: an http(s)
  // link, or a base58 on-chain value (PDA/address ~32-44 chars, or a tx signature ~64-88).
  const imageTrim = imageUrl.trim();
  const isImageLink = /^https?:\/\/\S+$/i.test(imageTrim);
  const isOnChainRef = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(imageTrim);
  const imageValid = imageTrim === "" || isImageLink || isOnChainRef;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 border-b px-3.5 py-3 shrink-0" style={{ borderColor: "#1d1d20" }}>
        <button
          onClick={onBack}
          aria-label="Back"
          className="an-bracket flex shrink-0 items-center justify-center"
          style={{ width: "32px", height: "32px", border: "1px solid #1f1f23", color: "#cfcfcf", "--ts": "7px", "--bk": "#0d0d0e", "--tk": "#6e6e72" } as CSSProperties}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <span className="an-term-title text-[16px]">Publish {kind === "workflow" ? "Workflow" : "Skill"}</span>
      </header>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        <div className="flex items-center gap-2">
          {(["skill", "workflow"] as const).map((k) => {
            const t = PUBLISH_THEME[k];
            const on = kind === k;
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`an-term-mono px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border rounded-md transition-colors ${
                  on ? `${t.border} ${t.onText} bg-gradient-to-b ${t.wash} to-transparent` : "border-zinc-800 text-zinc-500"
                }`}
              >
                {k}
              </button>
            );
          })}
        </div>
        <Field label="Name *">
          <input
            className="an-term-field"
            placeholder="My Skill"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <input
            className="an-term-field"
            placeholder="What does this skill do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="SKILL.md content *">
          <textarea
            className="an-term-field"
            rows={8}
            placeholder="# My Skill&#10;&#10;## Description&#10;…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label="Category">
          <input
            className="an-term-field"
            placeholder="e.g. coding, writing"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Field>
        <Field label="Hashtags (comma-separated)">
          <input
            className="an-term-field"
            placeholder="ai, productivity"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
          />
        </Field>
        <Field label="Price (SOL)">
          <input
            className="an-term-field"
            type="number"
            min="0"
            step="0.001"
            placeholder="0"
            value={priceSol}
            onChange={(e) => setPriceSol(e.target.value)}
          />
        </Field>
        <Field label="Cover Image (optional)">
          <div className="flex items-center gap-2">
            <span className="shrink-0 grid h-9 w-9 place-items-center rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
              {isImageLink ? (
                // <img> only — a linked image is decoded, never executed (scripts in an SVG
                // don't run via <img>); no-referrer avoids leaking the page as a tracker ping.
                <img src={imageTrim} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              ) : (
                <ImageIcon className="h-4 w-4 text-zinc-600" />
              )}
            </span>
            <input
              className="an-term-field"
              placeholder="Image link, on-chain address, or tx id"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </div>
          {imageTrim && !imageValid ? (
            <p className="mt-1 text-[10px] text-red-400 leading-relaxed">
              Only a link (https://…), an on-chain address, or a transaction id is allowed here.
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-zinc-600 leading-relaxed">
              Paste a link (https), an on-chain image address, or a tx id. File upload isn&apos;t supported — and a link keeps publishing to fewer signatures.
            </p>
          )}
        </Field>
        {kind === "workflow" && (
          <Field label="Required skills * (owned skills this workflow needs)">
            {state.marketOwned.length === 0 ? (
              <p className="an-term-mono text-[10px]" style={{ color: "#5a5a5d" }}>
                You don&apos;t own any skills yet — buy at least one before publishing a workflow.
              </p>
            ) : (
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                {state.marketOwned.map((skillName) => {
                  const mint = state.marketOwnedMints[skillName];
                  if (!mint) return null;
                  const on = !!requiredSkills[mint];
                  return (
                    <label key={mint} className="flex items-center gap-3 cursor-pointer active:opacity-80">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setRequiredSkills((s) => ({ ...s, [mint]: !s[mint] }))}
                        className="sr-only"
                      />
                      <span
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center"
                        style={{ border: on ? "1px solid #2f6b46" : "1px solid #3a3a3d", background: on ? "#0d160f" : "#0c0c0d" }}
                      >
                        {on && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        )}
                      </span>
                      <span className="an-term-mono truncate text-[12px] font-bold" style={{ color: on ? "#f2f2f2" : "#cfcfcf" }}>{skillName}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Field>
        )}
      </div>

      <div className="shrink-0 bg-transparent p-3 an-tabbar-inset">
        {/* Failure surfaces here as a bubble (not a separate page) so the filled-in form stays put. */}
        {result && !result.ok && (
          <div className="relative mb-3 rounded-lg border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-300">
            <span className="font-medium text-red-200">Publish failed. </span>{result.error}
            <span className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45 border-b border-r border-red-500/40 bg-red-950/60" />
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !text.trim() || !imageValid || (kind === "workflow" && chosenSkills.length === 0)}
          className={kind === "workflow" ? "an-btn an-btn-amber" : "an-btn an-btn-violet"}
        >
          {submitting ? "Minting NFT…" : `Mint & Publish ${kind === "workflow" ? "Workflow" : "Skill"}`}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="an-term-label block">{label}</label>
      {children}
    </div>
  );
}
