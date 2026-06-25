import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { ImageIcon, SkillIcon } from "../icons";

// The on-chain stages publish walks through, in order. Each is at least one wallet
// signature; "store" may be many (the body chunks). Used to render the forge gauge.
const PUBLISH_PHASES = [
  { key: "store", label: "Storing skill on-chain" },
  { key: "mint", label: "Minting the NFT" },
  { key: "list", label: "Listing for sale" },
] as const;

function PublishProgressView({ progress }: { progress: { phase: "store" | "mint" | "list"; signed: number; percent?: number } | null }) {
  const idx = progress ? Math.max(0, PUBLISH_PHASES.findIndex((p) => p.key === progress.phase)) : 0;
  // Completed phases + the code-in sub-percent of the store phase fill the gauge.
  const sub = progress?.phase === "store" && progress.percent != null ? progress.percent / 100 : idx > 0 ? 1 : 0;
  const overall = Math.min(100, Math.round(((idx + sub) / PUBLISH_PHASES.length) * 100));
  const signed = progress?.signed ?? 0;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b border-purple-800/40 px-3 py-2 shrink-0">
        <span className="font-medium text-sm text-purple-200">Forging your skill</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center bg-gradient-to-b from-purple-900/25 to-transparent">
        <SkillIcon className="h-12 w-12 text-purple-300 publish-forge-pulse" />

        <div className="w-full max-w-xs space-y-3">
          {/* Phase steps */}
          <div className="flex items-center justify-between gap-1">
            {PUBLISH_PHASES.map((p, i) => (
              <div key={p.key} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`h-1.5 w-full rounded-full ${i < idx ? "bg-purple-400" : i === idx ? "bg-purple-400 publish-forge-pulse" : "bg-zinc-700"}`}
                />
                <span className={`text-[10px] ${i === idx ? "text-purple-300" : "text-zinc-600"}`}>{i + 1}/{PUBLISH_PHASES.length}</span>
              </div>
            ))}
          </div>

          {/* Gauge */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-300 transition-[width] duration-300" style={{ width: `${overall}%` }} />
          </div>

          <p className="text-sm text-purple-200 font-medium">{PUBLISH_PHASES[idx].label}</p>
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [priceSol, setPriceSol] = useState("0");
  const [imageUrl, setImageUrl] = useState(""); // http/on-chain link only — no file upload
  const [submitting, setSubmitting] = useState(false);

  const result = state.publishResult;

  // A result (success OR failure) ends the in-flight state so the form/button come back.
  useEffect(() => { if (result) setSubmitting(false); }, [result]);

  function handleSubmit() {
    if (!name.trim() || !text.trim()) return;
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
          <span className="font-medium text-sm">Publish Skill</span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center bg-gradient-to-b from-purple-900/25 to-transparent">
          <SkillIcon className="h-10 w-10 text-purple-400" />
          <p className="text-purple-300 font-semibold">Skill minted!</p>
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
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="font-medium text-sm">Publish Skill</span>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <Field label="Name *">
          <input
            className="input-field"
            placeholder="My Skill"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <input
            className="input-field"
            placeholder="What does this skill do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="SKILL.md content *">
          <textarea
            className="input-field font-mono text-xs"
            rows={8}
            placeholder="# My Skill&#10;&#10;## Description&#10;…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label="Category">
          <input
            className="input-field"
            placeholder="e.g. coding, writing"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Field>
        <Field label="Hashtags (comma-separated)">
          <input
            className="input-field"
            placeholder="ai, productivity"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
          />
        </Field>
        <Field label="Price (SOL)">
          <input
            className="input-field"
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
              className="input-field"
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
      </div>

      <div className="shrink-0 border-t border-purple-800/40 bg-gradient-to-t from-purple-900/30 to-transparent p-3 an-tabbar-inset">
        {/* Failure surfaces here as a bubble (not a separate page) so the filled-in form stays put. */}
        {result && !result.ok && (
          <div className="relative mb-3 rounded-lg border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-300">
            <span className="font-medium text-red-200">Publish failed. </span>{result.error}
            <span className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45 border-b border-r border-red-500/40 bg-red-950/60" />
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !text.trim() || !imageValid}
          className="w-full rounded-xl bg-purple-600 py-3 text-sm font-semibold text-white active:bg-purple-500 disabled:opacity-50"
        >
          {submitting ? "Minting NFT…" : "Mint & Publish"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-zinc-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
