import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { ImageIcon, SkillIcon, WarningIcon } from "../icons";

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
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>("image/png");
  const [submitting, setSubmitting] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);

  function handleImageFile(file: File) {
    setImageMime(file.type || "image/png");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageDataUrl(dataUrl);
      const comma = dataUrl.indexOf(",");
      if (comma >= 0) setImageBase64(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  }

  const result = state.publishResult;

  function handleSubmit() {
    if (!name.trim() || !text.trim()) return;
    setSubmitting(true);
    clearPublishResult();
    send({
      type: "publishSkill",
      name: name.trim(),
      description: description.trim(),
      text: text.trim(),
      category: category.trim() || undefined,
      hashtags: hashtags.split(",").map((h) => h.trim()).filter(Boolean),
      priceSol: priceSol || "0",
      image: imageBase64 ? `data:${imageMime};base64,${imageBase64}` : undefined,
    });
    setTimeout(() => setSubmitting(false), 15000);
  }

  if (result) {
    return (
      <div className="flex flex-col h-full">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
          <button onClick={() => { clearPublishResult(); onBack(); }} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
          <span className="font-medium text-sm">Publish Skill</span>
        </header>
        <div
          className={`flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center ${
            result.ok ? "bg-gradient-to-b from-purple-900/25 to-transparent" : ""
          }`}
        >
          {result.ok ? (
            <>
              <SkillIcon className="h-10 w-10 text-purple-400" />
              <p className="text-purple-300 font-semibold">Skill minted!</p>
              {result.mint && <p className="font-mono text-xs text-zinc-500">{result.mint}</p>}
              <button onClick={() => { clearPublishResult(); onBack(); }} className="mt-2 text-sm text-zinc-400 underline">Back to market</button>
            </>
          ) : (
            <>
              <WarningIcon className="h-10 w-10 text-red-400" />
              <p className="text-red-400 font-semibold">Publish failed</p>
              <p className="text-xs text-zinc-500">{result.error}</p>
              <button onClick={() => { clearPublishResult(); setSubmitting(false); }} className="mt-2 text-sm text-zinc-400 underline">Try again</button>
            </>
          )}
        </div>
      </div>
    );
  }

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
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); e.target.value = ""; }}
          />
          {imageDataUrl ? (
            <div className="flex items-center gap-2">
              <img src={imageDataUrl} alt="preview" className="h-14 w-14 rounded-lg object-cover border border-zinc-700" />
              <button
                type="button"
                onClick={() => { setImageDataUrl(null); setImageBase64(null); }}
                className="text-xs text-zinc-500 underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => imgInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-xs text-zinc-500 active:bg-zinc-800 w-full"
            >
              <ImageIcon className="h-4 w-4" /> Choose image
            </button>
          )}
        </Field>
      </div>

      <div className="shrink-0 border-t border-purple-800/40 bg-gradient-to-t from-purple-900/30 to-transparent p-3 an-tabbar-inset">
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !text.trim()}
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
