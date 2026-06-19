import { useState } from "react";
import { useStore } from "../state/store";
import type { SkillCard, SkillDetail } from "../transport/protocol";
import { SkillIcon } from "../icons";

interface Props {
  detail: SkillDetail;
  owned: boolean;
  onBack: () => void;
  onOpenSkill?: (card: SkillCard) => void;
}

export function SkillDetailView({ detail, owned, onBack, onOpenSkill }: Props) {
  const { send, state } = useStore();
  const [buying, setBuying] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteGitLink, setNoteGitLink] = useState("");
  const { card, skillText, notes } = detail;
  const priceSol = card.price ? (Number(card.price) / 1_000_000_000).toFixed(3) : null;
  const disposed = Object.values(state.marketDisposed).includes(card.id);

  function handleBuy() {
    setBuying(true);
    send({ type: "buySkill", skillId: card.id, creatorWallet: card.creator });
    setTimeout(() => setBuying(false), 5000);
  }

  function handleNote() {
    if (!noteText.trim()) return;
    send({ type: "postNote", skillId: card.id, skillType: card.type, text: noteText.trim(), gitLink: noteGitLink.trim() || undefined });
    setNoteText("");
    setNoteGitLink("");
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
        {disposed && (
          <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-800 text-zinc-500">
            un-equipped
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="flex items-start gap-3">
          {card.image ? (
            <img src={card.image} alt="" className="h-14 w-14 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-zinc-800 shrink-0 flex items-center justify-center text-zinc-400"><SkillIcon className="h-7 w-7" /></div>
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

        {Array.isArray(detail.requiredCards) && detail.requiredCards.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Required skills</p>
            <div className="space-y-2">
              {detail.requiredCards.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => onOpenSkill?.(req)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-left active:bg-zinc-800"
                >
                  <p className="text-xs font-medium text-zinc-200">{req.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{req.description}</p>
                </button>
              ))}
            </div>
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
            <input
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
              placeholder="GitHub link (optional)"
              value={noteGitLink}
              onChange={(e) => setNoteGitLink(e.target.value)}
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

      {owned && (
        <div className="shrink-0 border-t border-red-900/40 bg-gradient-to-t from-red-950/30 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => send({ type: "disposeSkill", skillId: card.id })}
            className="w-full rounded-xl border border-red-500/30 bg-red-950/20 py-3 text-sm font-semibold text-red-400 active:bg-red-900/30"
          >
            Remove Skill
          </button>
        </div>
      )}

      {!owned && disposed && (
        <div className="shrink-0 border-t border-green-800/40 bg-gradient-to-t from-green-900/30 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => send({ type: "reEquipSkill", skillId: card.id })}
            className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white active:bg-green-500"
          >
            Re-equip Skill
          </button>
        </div>
      )}

      {!owned && !disposed && (
        <div className="shrink-0 border-t border-amber-700/40 bg-gradient-to-t from-amber-900/30 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={handleBuy}
            disabled={buying}
            className="w-full rounded-xl bg-amber-400 py-3 text-sm font-semibold text-zinc-900 active:bg-amber-300 disabled:opacity-50"
          >
            {buying ? "Buying…" : priceSol ? `Buy for ${priceSol} SOL` : "Buy (free)"}
          </button>
        </div>
      )}
    </div>
  );
}
