import { useState } from "react";
import { useStore } from "../state/store";
import type { SkillDetail } from "../transport/protocol";

interface Props {
  detail: SkillDetail;
  owned: boolean;
  onBack: () => void;
}

export function SkillDetailView({ detail, owned, onBack }: Props) {
  const { send } = useStore();
  const [buying, setBuying] = useState(false);
  const [noteText, setNoteText] = useState("");
  const { card, skillText, notes } = detail;
  const priceSol = card.price ? (Number(card.price) / 1_000_000_000).toFixed(3) : null;

  function handleBuy() {
    setBuying(true);
    send({ type: "buySkill", skillId: card.id, creatorWallet: card.creator });
    setTimeout(() => setBuying(false), 5000);
  }

  function handleNote() {
    if (!noteText.trim()) return;
    send({ type: "postNote", skillId: card.id, skillType: card.type, text: noteText.trim() });
    setNoteText("");
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="truncate font-medium text-sm">{card.name}</span>
        {owned && (
          <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-900/60 text-green-400">
            owned
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="flex items-start gap-3">
          {card.image ? (
            <img src={card.image} alt="" className="h-14 w-14 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-zinc-800 shrink-0 flex items-center justify-center text-2xl">🔮</div>
          )}
          <div className="min-w-0">
            <p className="text-sm text-zinc-300">{card.description}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
              {card.category && <span className="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{card.category}</span>}
              {card.hashtags?.map((h) => (
                <span key={h} className="bg-zinc-800/60 text-zinc-500 px-1.5 py-0.5 rounded">#{h}</span>
              ))}
              {card.supply != null && <span className="text-zinc-600">↑{card.supply} holders</span>}
            </div>
          </div>
        </div>

        {skillText && (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
            <p className="text-[11px] text-zinc-500 mb-1 uppercase tracking-wide">SKILL.md</p>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono overflow-x-auto">{skillText}</pre>
          </div>
        )}

        {Array.isArray(notes) && notes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Comments</p>
            {(notes as any[]).map((n: any, i) => (
              <div key={i} className="rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-xs text-zinc-300">
                <span className="font-mono text-zinc-600 text-[10px]">{n.author?.slice(0, 6)}…</span>
                <p className="mt-0.5">{n.text}</p>
              </div>
            ))}
          </div>
        )}

        {owned && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Leave a comment</p>
            <textarea
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 text-xs text-zinc-200 resize-none focus:outline-none focus:border-green-500/50"
              rows={3}
              placeholder="Share your experience…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button
              onClick={handleNote}
              disabled={!noteText.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 disabled:opacity-40 active:bg-zinc-700"
            >
              Post
            </button>
          </div>
        )}
      </div>

      {!owned && (
        <div className="shrink-0 border-t border-zinc-800 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={handleBuy}
            disabled={buying}
            className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white active:bg-green-500 disabled:opacity-50"
          >
            {buying ? "Buying…" : priceSol ? `Buy for ${priceSol} SOL` : "Buy (free)"}
          </button>
        </div>
      )}
    </div>
  );
}
