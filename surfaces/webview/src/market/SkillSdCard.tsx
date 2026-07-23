import { useMemo } from "react";
import type { SkillCard } from "../transport/protocol";
import { skillSigilSvg } from "./skillSigil";
import { mediaUrl } from "./mediaUrl";

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
  const img = mediaUrl(card.image);
  const sigil = useMemo(() => (img ? "" : skillSigilSvg(card.name, card.category)), [img, card.name, card.category]);
  const cat = (card.category || (isWorkflow ? "workflow" : "skill")).toUpperCase().slice(0, 8);
  const ty = isWorkflow ? "/ FLOW" : "/ SKILL";
  const state = disposed ? "OFF" : owned ? "OWNED" : "GET";

  return (
    <button
      onClick={() => onOpen(card)}
      className={`an-sd ${img ? "has-img" : ""} ${isWorkflow ? "is-workflow" : ""} ${disposed ? "is-disposed" : ""} ${dim ? "is-owned-dim" : ""} ${firing ? "is-firing" : ""}`}
    >
      <span className="an-sd-tab" />
      <div className="an-sd-label">
        {/* 4c face: the minted card PNG when the item has one; the sigil otherwise */}
        {img ? (
          <img className="an-sd-img" src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <svg className="an-sd-art" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sigil }} />
        )}
        {/* 2a layout: barcode alone top-left; mark + star share the right axis (sigil face only) */}
        <span className="an-sd-bar" aria-hidden="true" />
        <div className="an-sd-mark"><span className="cat">{cat}</span> <span className="ty">{ty}</span></div>
        {/* the hero: the name big over the sigil, shadowed for legibility */}
        <div className="an-sd-name">{card.name}</div>
        {/* the data chip: copies big, price + state stacked small */}
        <div className="an-sd-chip">
          <span className="an-sd-big">{card.supply ?? "—"}</span>
          <span className="an-sd-meta">{priceSol ? `${priceSol}◎` : "FREE"}<br />{state}</span>
        </div>
        {/* 2a gold star grade: summed GitHub stars of repos using this skill (issue #89), corner
            brackets on the right axis under the mark. Hidden at 0 so plain skills stay clean. */}
        {card.stars ? (
          <div className="an-sd-grade"><span className="st">★</span>{card.stars}</div>
        ) : null}
      </div>
    </button>
  );
}
