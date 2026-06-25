import type { SkillCard } from "../transport/protocol";
import { SkillIcon, CollectionIcon } from "../icons";

interface Props {
  card: SkillCard;
  owned?: boolean;
  disposed?: boolean;
  firing?: boolean;
  onOpen: (card: SkillCard) => void;
}

// Skills vs workflows read as two item classes (game convention: a crafted/"composite"
// item gets a gold frame + distinct mark, a plain item stays neutral). A workflow = a
// synthesis of skills, so it gets an amber frame, the collection glyph, a WORKFLOW tag,
// and its required-skill count. A plain skill keeps the neutral zinc card.
export function SkillCardTile({ card, owned, disposed, firing, onOpen }: Props) {
  const priceSol = card.price ? (Number(card.price) / 1_000_000_000).toFixed(3) : null;
  const isWorkflow = card.type === "workflow";
  const reqCount = card.requiredSkills?.length ?? 0;
  return (
    <button
      onClick={() => onOpen(card)}
      className={[
        "w-full text-left rounded-xl border p-3 transition-all active:scale-[0.98]",
        isWorkflow
          ? "border-amber-500/45 bg-gradient-to-br from-amber-950/25 to-zinc-900 hover:border-amber-400/70"
          : "border-zinc-800 bg-zinc-900 hover:border-zinc-600",
        firing ? "skill-firing border-green-500/60" : "",
        owned ? "border-l-2 border-l-green-500" : "",
        disposed ? "opacity-55 grayscale border-dashed border-zinc-700" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        {card.image ? (
          <img src={card.image} alt="" referrerPolicy="no-referrer" className={`h-10 w-10 rounded-lg object-cover shrink-0 ${isWorkflow ? "ring-1 ring-amber-500/50" : ""}`} />
        ) : (
          <div className={`h-10 w-10 rounded-lg shrink-0 flex items-center justify-center ${isWorkflow ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-400"}`}>
            {isWorkflow ? <CollectionIcon className="h-5 w-5" /> : <SkillIcon className={firing ? "h-5 w-5 text-green-400" : "h-5 w-5"} />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {isWorkflow && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide bg-amber-500/20 text-amber-300">WORKFLOW</span>
            )}
            <span className="truncate font-medium text-sm text-zinc-100">{card.name}</span>
            {owned && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold bg-green-900/60 text-green-400">
                owned
              </span>
            )}
            {disposed && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold bg-zinc-800 text-zinc-500">
                un-equipped
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
            {isWorkflow && reqCount > 0 && <span className="font-medium text-amber-400/80">{reqCount} skills</span>}
            {card.category && <span>{card.category}</span>}
            {card.supply != null && <span>↑{card.supply}</span>}
            {priceSol && <span className="text-green-500/80">{priceSol} SOL</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
