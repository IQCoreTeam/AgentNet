import type { SkillCard } from "../transport/protocol";
import { BookIcon, CollectionIcon } from "../icons";
import { mediaUrl } from "./mediaUrl";

interface Props {
  card: SkillCard;
  owned?: boolean;
  disposed?: boolean;
  firing?: boolean;
  // "row" = wide horizontal card (the 1-col stack + market list). "tile" = a squarer vertical
  // card (icon + name on top, text below) for the 2-col grid, too narrow for a good row.
  layout?: "row" | "tile";
  onOpen: (card: SkillCard) => void;
}

// Clean, BORDERLESS skill/workflow card. No frame/tint — the ONE accent is the item glyph,
// which carries color ONLY when equipped (owned): green for a skill, amber for a workflow. The
// glyph also marks the TYPE: a skill is a book, a workflow is the collection grid.
export function SkillCardTile({ card, owned, disposed, firing, layout = "row", onOpen }: Props) {
  const priceSol = card.price ? (Number(card.price) / 1_000_000_000).toFixed(3) : null;
  const isWorkflow = card.type === "workflow";
  const reqCount = card.requiredSkills?.length ?? 0;
  const cover = mediaUrl(card.image);
  const ownColor = isWorkflow ? "var(--an-amber)" : "var(--an-green)";
  const Glyph = isWorkflow ? CollectionIcon : BookIcon; // skill = book, workflow = grid
  const glyphStyle = { color: owned ? ownColor : "var(--an-fg-mute)" } as const;
  const wfTag = isWorkflow ? `WF${reqCount > 0 ? `·${reqCount}` : ""}` : null;
  const base = `rounded-xl bg-an-bg-1 text-left transition active:scale-[0.98] ${disposed ? "opacity-55 grayscale" : ""}`;

  // ── Tile (2-col) — NAME-focused card: a small type glyph (colored when owned) beside the
  //    title, then the description + meta fill the height so it reads as a card, not a row. ──
  if (layout === "tile") {
    return (
      <button onClick={() => onOpen(card)} className={`flex flex-col ${base} p-3`}>
        {cover && (
          <img src={cover} alt="" referrerPolicy="no-referrer" className="mb-2 h-20 w-full rounded-lg object-cover" />
        )}
        <div className="flex items-start gap-1.5">
          <Glyph className={`mt-0.5 h-4 w-4 shrink-0 ${firing ? "animate-pulse" : ""}`} style={glyphStyle} />
          <span className="line-clamp-2 text-sm font-semibold text-an-fg">{card.name}</span>
        </div>
        {card.description && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-an-fg-mute">{card.description}</p>
        )}
        <div className="mt-2 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] text-an-fg-mute">
          {wfTag && <span className="shrink-0 font-bold uppercase tracking-wide">{wfTag}</span>}
          {card.supply != null && <span className="shrink-0">{"↑"}{card.supply}</span>}
          {priceSol && <span className="shrink-0">{priceSol} SOL</span>}
          {disposed && <span className="shrink-0">un-equipped</span>}
        </div>
      </button>
    );
  }

  // ── Wide row (1-col stack + market list) — icon left, text right. ──
  return (
    <button onClick={() => onOpen(card)} className={`w-full ${base} p-3`}>
      <div className="flex items-start gap-2.5">
        <div className="relative h-10 w-10 shrink-0">
          {cover ? (
            <img src={cover} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-an-bg-2">
              <Glyph className={`h-5 w-5 ${firing ? "animate-pulse" : ""}`} style={glyphStyle} />
            </div>
          )}
          {cover && owned && (
            <Glyph className={`absolute -right-1 -top-1 h-3.5 w-3.5 ${firing ? "animate-pulse" : ""}`} style={{ color: ownColor }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-an-fg">{card.name}</span>
            {wfTag && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-an-fg-mute">{wfTag}</span>}
            {disposed && <span className="shrink-0 text-[10px] text-an-fg-mute">un-equipped</span>}
            {firing && <span className="shrink-0 animate-pulse text-[10px] text-an-fg-dim">casting</span>}
          </div>
          {card.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-an-fg-mute">{card.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-an-fg-mute">
            {card.category && <span className="truncate">{card.category}</span>}
            {card.supply != null && <span className="shrink-0">{"↑"}{card.supply}</span>}
            {priceSol && <span className="shrink-0">{priceSol} SOL</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
