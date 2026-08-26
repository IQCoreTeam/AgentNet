import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { useStore } from "../state/store";
import { haptics } from "../haptics";
import type { SkillCard, SkillDetail } from "../transport/protocol";
import { SkillIcon } from "../icons";
import { mediaUrl } from "./mediaUrl";
import { walletAvatarSvg } from "./walletAvatar";
import { CompleteCelebration } from "./CompleteCelebration";
import { LockedGate } from "../unlock/UnlockProvider";

function shortAddr(w?: string) {
  return w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "";
}

// Accent-green 12px corner ticks that frame the hero card as an owned-object plaque (matching
// the OWNED button family). Purely decorative, so it stays out of the tab order.
function Corners() {
  const g = "var(--an-term-green)";
  const base = "pointer-events-none absolute h-3 w-3";
  return (
    <>
      <span className={base} style={{ top: -1, left: -1, borderTop: `2px solid ${g}`, borderLeft: `2px solid ${g}` }} />
      <span className={base} style={{ top: -1, right: -1, borderTop: `2px solid ${g}`, borderRight: `2px solid ${g}` }} />
      <span className={base} style={{ bottom: -1, left: -1, borderBottom: `2px solid ${g}`, borderLeft: `2px solid ${g}` }} />
      <span className={base} style={{ bottom: -1, right: -1, borderBottom: `2px solid ${g}`, borderRight: `2px solid ${g}` }} />
    </>
  );
}

// A `> LABEL` terminal section header + its body. Labels are uppercased in green, matching the
// card art's engraving and the rest of the terminal surfaces.
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mx-4 mt-5">
      <div className="an-term-mono mb-2 text-[10px] uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-green)" }}>&gt; {label}</div>
      {children}
    </div>
  );
}

interface Props {
  detail: SkillDetail;
  owned: boolean;
  onBack: () => void;
  onOpenSkill?: (card: SkillCard) => void;
}

// Card-hero detail view (design "Skill Detail - Card Hero", direction 1): the minted 1:1 card
// PNG is the hero, so the old icon + title + description head is dropped (the wordmark is baked
// into the art; a visually-hidden h1 keeps the live name for a11y). Below the card: the action
// bar (Buy / Owned + Unequip), a meta line, then the live/accessible body the art cannot do -
// full untruncated > ABOUT, live hashtag chips, > SKILL TEXT, and > COMMENTS. Items with no
// image degrade to the sigil-icon + Chakra Petch title head. Skill-item comments are ON-CHAIN
// token gated: owners get the composer; non-owners get the collect-to-comment gate.
export function SkillDetailView({ detail, owned, onBack, onOpenSkill }: Props) {
  const { state, send } = useStore();
  const [buying, setBuying] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteGitLink, setNoteGitLink] = useState("");
  const [commentDone, setCommentDone] = useState(false);
  const [resumeComment, setResumeComment] = useState(false);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const awaitingNote = useRef(false);
  const lastToast = useRef(state.toast);
  const { card, skillText, notes } = detail;
  const priceSol = card.price ? (Number(card.price) / 1_000_000_000).toFixed(3) : null;
  const disposed = Object.values(state.marketDisposed).includes(card.id);

  // A workflow is gated on its required skills: you can only buy it once you own them all.
  const requiredCards = Array.isArray(detail.requiredCards) ? detail.requiredCards : [];
  const isWorkflow = requiredCards.length > 0;
  const ownedRequiredCount = requiredCards.filter((r) => state.marketOwned.includes(r.name)).length;
  const allRequiredOwned = ownedRequiredCount === requiredCards.length;
  const noteCount = Array.isArray(notes) ? notes.length : 0;

  function handleBuy() {
    haptics.strong();
    setBuying(true);
    send({ type: "buySkill", skillId: card.id, creatorWallet: card.creator });
    setTimeout(() => setBuying(false), 5000);
  }

  function handleNote() {
    if (!noteText.trim()) return;
    haptics.strong();
    awaitingNote.current = true;
    send({ type: "postNote", skillId: card.id, skillType: card.type, text: noteText.trim(), gitLink: noteGitLink.trim() || undefined });
    setNoteText("");
    setNoteGitLink("");
  }

  // Posting a comment celebrates with the shared COMPLETE plaque (design [COMMENT POSTED]). The
  // reducer sets toast "Comment posted." on postNoteResult.ok; fire once per our own post.
  useEffect(() => {
    if (state.toast === lastToast.current) return;
    lastToast.current = state.toast;
    if (awaitingNote.current && state.toast === "Comment posted.") {
      awaitingNote.current = false;
      setCommentDone(true);
    }
  }, [state.toast]);

  useEffect(() => {
    if (!owned || !resumeComment) return;
    noteInput.current?.focus();
    noteInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setResumeComment(false);
  }, [owned, resumeComment]);

  const img = mediaUrl(card.image);
  const solidGreen: CSSProperties = { background: "var(--an-term-green)", color: "var(--an-on-green)" };

  return (
    <div className="relative flex h-full flex-col" style={{ background: "var(--an-bg-0)" }}>
      {commentDone && <CompleteCelebration label="COMMENT POSTED" onDone={() => setCommentDone(false)} />}
      {/* live name for screen readers / find-in-page (the visible title lives in the card art) */}
      <h1 className="sr-only">{card.name}</h1>

      <div
        className="flex-1 overflow-y-auto an-tabbar-inset"
        style={{ paddingTop: "max(0.6rem, env(safe-area-inset-top))", paddingBottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 12px)" }}
      >
        {/* back */}
        <div className="px-4">
          <button onClick={() => { haptics.tick(); onBack(); }} className="an-term-mono text-[11px] uppercase tracking-[0.08em] active:opacity-70" style={{ color: "var(--an-term-fg-6)" }}>
            &lt; Back_to_market
          </button>
        </div>

        {/* HERO: the 1:1 card art as a bracket-corner plaque, or the sigil-icon fallback head */}
        {img ? (
          <div className="relative mx-4 mt-3">
            <div className="relative" style={{ border: "1px solid var(--an-term-line-2)", background: "#080b09" }}>
              <img
                src={img}
                alt={`${card.name} skill card`}
                referrerPolicy="no-referrer"
                className="block w-full"
                style={{ aspectRatio: "1 / 1", objectFit: "cover", imageRendering: "pixelated" }}
              />
              <Corners />
            </div>
          </div>
        ) : (
          <div className="mx-4 mt-3.5 flex items-center gap-3">
            <div className="relative grid h-14 w-14 shrink-0 place-items-center" style={{ border: "1px solid var(--an-term-green-line-2)", background: "var(--an-term-green-bg)", color: "var(--an-term-green)" }}>
              <SkillIcon className="h-7 w-7" />
              <span className="pointer-events-none absolute h-2 w-2" style={{ top: -1, left: -1, borderTop: "2px solid var(--an-term-green)", borderLeft: "2px solid var(--an-term-green)" }} />
              <span className="pointer-events-none absolute h-2 w-2" style={{ bottom: -1, right: -1, borderBottom: "2px solid var(--an-term-green)", borderRight: "2px solid var(--an-term-green)" }} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="an-term-mono text-[9px] uppercase" style={{ letterSpacing: "0.18em", color: "var(--an-term-fg-7)" }}>{isWorkflow ? "Workflow" : "Skill"}</span>
              <span className="truncate text-[19px] font-semibold" style={{ fontFamily: "var(--an-font-tech)", color: "var(--an-term-fg)" }}>{card.name}</span>
            </div>
          </div>
        )}

        {/* ACTION BAR — right under the card so Buy / Owned sit above the fold */}
        <div className="mx-4 mt-3">
          {owned && !disposed ? (
            <div className="flex items-center gap-2">
              <span className="flex h-11 flex-1 items-center justify-center an-term-mono text-[12px] font-bold uppercase" style={{ letterSpacing: "0.12em", border: "1px solid var(--an-term-green-line)", color: "var(--an-term-green)", background: "var(--an-term-green-bg)" }}>Owned</span>
              <button onClick={() => { haptics.tap(); send({ type: "disposeSkill", skillId: card.id }); }} className="flex h-11 flex-1 items-center justify-center an-term-mono text-[12px] font-bold uppercase active:opacity-80" style={{ letterSpacing: "0.12em", border: "1px solid var(--an-term-line-3)", color: "var(--an-fg-dim)" }}>Unequip</button>
            </div>
          ) : disposed ? (
            <button onClick={() => { haptics.tap(); send({ type: "reEquipSkill", skillId: card.id }); }} className="flex h-11 w-full items-center justify-center an-term-mono text-[12px] font-bold uppercase active:opacity-90" style={{ letterSpacing: "0.12em", ...solidGreen }}>Re-equip</button>
          ) : (
            <LockedGate reason="buy" onUnlocked={handleBuy}>
              <button
                onClick={handleBuy}
                disabled={buying || (isWorkflow && !allRequiredOwned)}
                className="flex h-11 w-full items-center justify-center an-term-mono text-[12px] font-bold uppercase active:opacity-90 disabled:opacity-40"
                style={{ letterSpacing: "0.12em", ...solidGreen }}
              >
                {buying
                  ? "Buying..."
                  : isWorkflow && !allRequiredOwned
                    ? `Collect ${requiredCards.length - ownedRequiredCount} more skill${requiredCards.length - ownedRequiredCount === 1 ? "" : "s"}`
                    : priceSol ? `Buy · ${priceSol} SOL` : "Buy · Free"}
              </button>
            </LockedGate>
          )}
        </div>

        {/* meta line: holders / price on the left, Magic Eden (owned only) on the right */}
        <div className="mx-4 mt-2.5 flex items-center justify-between an-term-mono text-[10px]" style={{ letterSpacing: "0.08em" }}>
          <span style={{ color: "var(--an-term-fg-7)" }}>
            {card.supply != null ? `${card.supply}x owned` : ""}
            {card.supply != null && priceSol ? " · " : ""}
            {priceSol ? `${priceSol} SOL` : card.supply == null ? "Free" : ""}
          </span>
          {owned && card.id && (
            <a href={`https://magiceden.io/item-details/${card.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="active:opacity-70" style={{ color: "var(--an-term-fg-6)" }}>
              Magic Eden ↗
            </a>
          )}
        </div>

        {/* > ABOUT — the full, untruncated, selectable description + live hashtag chips */}
        <Section label="About">
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{card.description}</p>
          {(card.category || card.hashtags?.length) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.category && (
                <span className="an-term-mono px-2 py-1 text-[10px] uppercase" style={{ letterSpacing: "0.06em", border: "1px solid var(--an-term-green-line)", color: "var(--an-term-green)", background: "var(--an-term-green-bg)" }}>{card.category}</span>
              )}
              {card.hashtags?.map((h) => (
                <span key={h} className="an-term-mono px-2 py-1 text-[10px]" style={{ border: "1px solid var(--an-term-line-2)", color: "var(--an-fg-mute)" }}>#{h}</span>
              ))}
            </div>
          )}
        </Section>

        {/* Required skills (workflow) — collect the parts before the workflow can be bought */}
        {isWorkflow && (() => {
          const unowned = requiredCards.filter((r) => !state.marketOwned.includes(r.name));
          const totalLamports = unowned.reduce((sum, r) => sum + (r.price ? Number(r.price) : 0), 0);
          const totalSol = totalLamports > 0 ? (totalLamports / 1_000_000_000).toFixed(3) : null;
          return (
            <div className="mx-4 mt-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="an-term-mono text-[10px] uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-green)" }}>
                  &gt; Required_skills <span style={{ color: allRequiredOwned ? "var(--an-term-green)" : "var(--an-amber)" }}>{ownedRequiredCount}/{requiredCards.length}</span>
                </div>
                {unowned.length > 0 && (
                  <LockedGate reason="buy" onUnlocked={() => { haptics.strong(); send({ type: "buyRequiredSkills", items: unowned.map((r) => ({ skillId: r.id, creatorWallet: r.creator })) }); }}>
                    <button
                      type="button"
                      onClick={() => { haptics.strong(); send({ type: "buyRequiredSkills", items: unowned.map((r) => ({ skillId: r.id, creatorWallet: r.creator })) }); }}
                      className="an-term-mono px-2.5 py-1 text-[10px] font-bold uppercase active:opacity-80"
                      style={{ letterSpacing: "0.06em", ...solidGreen }}
                    >
                      Collect {unowned.length}{totalSol ? ` · ${totalSol}` : ""}
                    </button>
                  </LockedGate>
                )}
              </div>
              <div className="space-y-1.5">
                {requiredCards.map((req) => {
                  const reqOwned = state.marketOwned.includes(req.name);
                  return (
                    <button
                      key={req.id}
                      type="button"
                      onClick={() => onOpenSkill?.(req)}
                      className="flex w-full items-center gap-2.5 p-2.5 text-left active:opacity-80"
                      style={{ border: reqOwned ? "1px solid var(--an-term-line-2)" : "1px dashed var(--an-term-green-line)", background: reqOwned ? "var(--an-bg-1)" : "var(--an-term-green-bg)" }}
                    >
                      {reqOwned ? (
                        <span className="grid h-5 w-5 shrink-0 place-items-center text-[11px] font-bold" style={solidGreen}>✓</span>
                      ) : (
                        <span className="h-5 w-5 shrink-0" style={{ border: "1px dashed var(--an-term-green-line)" }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="an-term-mono text-[12px]" style={{ color: "var(--an-term-fg)" }}>{req.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px]" style={{ color: "var(--an-fg-mute)" }}>{req.description}</p>
                      </div>
                      {reqOwned ? (
                        <span className="an-term-mono shrink-0 text-[10px] font-bold" style={{ color: "var(--an-term-green)" }}>owned</span>
                      ) : req.price ? (
                        <span className="an-term-mono shrink-0 text-[11px]" style={{ color: "var(--an-fg-dim)" }}>{(Number(req.price) / 1_000_000_000).toFixed(3)}</span>
                      ) : (
                        <span className="an-term-mono shrink-0 text-[11px]" style={{ color: "var(--an-fg-mute)" }}>free</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* > USED BY — repos that reference this skill, with their star grade */}
        {Array.isArray(detail.repos) && detail.repos.length > 0 && (
          <Section label="Used_by">
            <div className="space-y-1.5">
              {detail.repos.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2.5 active:opacity-80" style={{ border: "1px solid var(--an-term-line)", background: "var(--an-bg-1)" }}>
                  <span className="an-term-mono min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--an-fg-dim)" }}>{r.owner}/{r.name}</span>
                  <span className="an-term-mono shrink-0 text-[11px]" style={{ color: "var(--an-amber)" }}>★{r.stars}</span>
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* > SKILL TEXT — the raw SKILL.md */}
        {skillText && (
          <Section label="Skill_text">
            <pre className="an-term-mono overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed" style={{ border: "1px solid var(--an-term-line)", background: "#080b09", padding: "12px", color: "var(--an-fg-dim)" }}>{skillText}</pre>
          </Section>
        )}

        {/* > COMMENTS — on-chain token-gated: owners post, non-owners see the collect gate */}
        <Section label={`Comments (${noteCount})`}>
          {noteCount > 0 && (
            <div className="mb-3 flex flex-col">
              {(notes as any[]).map((n: any, i) => (
                <div key={i} className="border-t py-3 first:border-t-0" style={{ borderColor: "var(--an-term-line)" }}>
                  <div className="mb-2 flex items-center gap-2.5">
                    <div className="h-[22px] w-[22px] shrink-0 overflow-hidden" style={{ border: "1px solid var(--an-term-line-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(n.author ?? "") }} />
                    <span className="an-term-mono text-[11px]" style={{ color: "var(--an-term-fg)" }}>{shortAddr(n.author)}</span>
                  </div>
                  <p className="an-term-mono whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{n.text}</p>
                </div>
              ))}
            </div>
          )}
          {owned ? (
            <div className="space-y-2.5">
              <textarea
                ref={noteInput}
                className="an-term-field resize-none leading-relaxed"
                rows={4}
                placeholder="Write a comment..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <input
                className="an-term-field"
                placeholder="GitHub link (optional)"
                value={noteGitLink}
                onChange={(e) => setNoteGitLink(e.target.value)}
              />
              <div className="flex justify-end">
                <button onClick={handleNote} disabled={!noteText.trim()} className="an-btn an-btn-green w-auto px-6">Post</button>
              </div>
            </div>
          ) : !state.walletAddress ? (
            <LockedGate reason="comment" onUnlocked={() => { setResumeComment(true); send({ type: "ownedSkills" }); send({ type: "getSkillDetail", mint: card.id }); }}>
              <div className="an-term-mono px-3 py-2.5 text-[10px] uppercase" style={{ letterSpacing: "0.06em", border: "1px solid var(--an-term-line)", color: "var(--an-term-fg-7)" }}>
                <span style={{ color: "var(--an-term-green)" }}>&gt;</span>CONNECT_WALLET_ <span style={{ color: "var(--an-term-fg)" }}>Connect a wallet to comment.</span>
              </div>
            </LockedGate>
          ) : (
            <div className="an-term-mono px-3 py-2.5 text-[10px] uppercase" style={{ letterSpacing: "0.06em", border: "1px solid var(--an-term-green-line-2)", color: "var(--an-term-fg-7)" }}>
              <span style={{ color: "var(--an-term-green)" }}>&gt;</span>HOLDERS_ONLY_ <span style={{ color: "var(--an-term-fg)" }}>Collect this skill to comment.</span>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
