import { useMemo } from "react";
import type { SkillCard } from "../transport/protocol";
import { skillSigilSvg } from "./skillSigil";

interface Props {
  card: SkillCard;
  owned?: boolean;
  disposed?: boolean;
  firing?: boolean;
  dim?: boolean; // mute the card (market: already-owned, so it reads as "got it")
  onOpen: (card: SkillCard) => void;
}

// A skill as an "SD-card" collectible. The cartridge body is a chic deep GREY (gold for
// workflows) so it reads like real cartridge plastic. The dark label carries a magic-circle
// sigil generated deterministically from the name, a "[ CAT / SKILL ]" mark, an optional gold
// star grade in the top-left slot, the NAME big over the sigil, and a small coral data CHIP
// (copies / price / state) at the bottom. Used everywhere skills are listed so the whole app
// reads as one collection.
export function SkillSdCard({ card, owned, disposed, firing, dim, onOpen }: Props) {
  const isWorkflow = card.type === "workflow";
  const priceSol = card.price && card.price !== "0" ? (Number(card.price) / 1e9).toFixed(2) : null;
  const sigil = useMemo(() => skillSigilSvg(card.name, card.category), [card.name, card.category]);
  const cat = (card.category || (isWorkflow ? "workflow" : "skill")).toUpperCase().slice(0, 8);
  const ty = isWorkflow ? "/ FLOW" : "/ SKILL";
  const state = disposed ? "OFF" : owned ? "OWNED" : "GET";

  return (
    <button
      onClick={() => onOpen(card)}
      className={`an-sd ${isWorkflow ? "is-workflow" : ""} ${disposed ? "is-disposed" : ""} ${dim ? "is-owned-dim" : ""} ${firing ? "is-firing" : ""}`}
    >
      <span className="an-sd-tab" />
      <div className="an-sd-label">
        <svg className="an-sd-art" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sigil }} />
        <div className="an-sd-mark"><span className="br">[</span><span className="cat">{cat}</span> <span className="ty">{ty}</span><span className="br">]</span></div>
        {/* the hero: the name big over the sigil, shadowed for legibility */}
        <div className="an-sd-name">{card.name}</div>
        {/* the data chip: copies big, price + state stacked small */}
        <div className="an-sd-chip">
          <span className="an-sd-big">{card.supply ?? "—"}</span>
          <span className="an-sd-meta">{priceSol ? `${priceSol}◎` : "FREE"}<br />{state}</span>
        </div>
        {/* 3a gold star grade: summed GitHub stars of repos using this skill (issue #89), a thin
            translucent-gold box in the barcode's old top-left slot. Hidden at 0 so plain skills stay clean. */}
        {card.stars ? (
          <div className="an-sd-grade"><span className="st">★</span>{card.stars}</div>
        ) : null}
      </div>
    </button>
  );
}
