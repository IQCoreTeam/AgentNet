import type { SkillCard } from "../transport/protocol";
import { SkillIcon } from "../icons";

interface Props {
  card: SkillCard;
  owned?: boolean;
  firing?: boolean;
  onOpen: (card: SkillCard) => void;
}

export function SkillCardTile({ card, owned, firing, onOpen }: Props) {
  const priceSol = card.price ? (Number(card.price) / 1_000_000_000).toFixed(3) : null;
  return (
    <button
      onClick={() => onOpen(card)}
      className={[
        "w-full text-left rounded-xl border p-3 transition-all",
        "bg-zinc-900 border-zinc-800 hover:border-zinc-600 active:scale-[0.98]",
        firing ? "skill-firing border-green-500/60" : "",
        owned ? "border-l-2 border-l-green-500" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        {card.image ? (
          <img src={card.image} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="h-10 w-10 rounded-lg bg-zinc-800 shrink-0 flex items-center justify-center text-zinc-400">
            <SkillIcon className={firing ? "h-5 w-5 text-green-400" : "h-5 w-5"} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate font-medium text-sm text-zinc-100">{card.name}</span>
            {owned && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold bg-green-900/60 text-green-400">
                owned
              </span>
            )}
            {firing && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold bg-green-500/20 text-green-300 animate-pulse">
                casting
              </span>
            )}
          </div>
          {card.description && (
            <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{card.description}</p>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-600">
            {card.category && <span>{card.category}</span>}
            {card.supply != null && <span>↑{card.supply}</span>}
            {priceSol && <span className="text-green-500/80">{priceSol} SOL</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
