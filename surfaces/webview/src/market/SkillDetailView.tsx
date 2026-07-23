import { useEffect, useRef, useState } from "react";
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

interface Props {
  detail: SkillDetail;
  owned: boolean;
  onBack: () => void;
  onOpenSkill?: (card: SkillCard) => void;
}

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

  return (
    <div className="relative flex flex-col h-full">
      {commentDone && <CompleteCelebration label="COMMENT POSTED" onDone={() => setCommentDone(false)} />}
      <header className="flex items-center gap-2 border-b border-zinc-800 px-2.5 shrink-0" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))", paddingBottom: "0.55rem" }}>
        <button onClick={() => { haptics.tick(); onBack(); }} className="an-iconbtn shrink-0" aria-label="Back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></button>
        {isWorkflow && (
          <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide bg-amber-500/20 text-amber-300">WORKFLOW</span>
        )}
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

      <div className="flex-1 overflow-y-auto p-3 space-y-4" style={{ paddingBottom: "calc(var(--tabbar-height, 0px) + max(0.75rem, env(safe-area-inset-bottom)) + 76px)" }}>
        <div className="flex items-start gap-3">
          {mediaUrl(card.image) ? (
            <img src={mediaUrl(card.image)} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-xl object-cover shrink-0" />
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
              {card.stars ? <span className="text-amber-400">★{card.stars}</span> : null}
              {/* inventory only: a small jump to the item's public marketplace page */}
              {owned && card.id && (
                <a
                  href={`https://magiceden.io/item-details/${card.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="border border-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded active:opacity-80"
                >
                  MAGIC EDEN
                </a>
              )}
            </div>
          </div>
        </div>

        {skillText && (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
            <p className="text-[11px] text-zinc-500 mb-1 uppercase tracking-wide">SKILL.md</p>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono overflow-x-auto">{skillText}</pre>
          </div>
        )}

        {Array.isArray(detail.repos) && detail.repos.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">
              Used by · <span className="text-amber-400">★{card.stars ?? detail.repos.reduce((s, r) => s + (r.stars || 0), 0)}</span>
            </p>
            <div className="space-y-1.5">
              {detail.repos.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-sm active:opacity-80">
                  <span className="min-w-0 flex-1 truncate text-zinc-300">{r.owner}/{r.name}</span>
                  <span className="shrink-0 text-[11px] text-amber-400">★{r.stars}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {isWorkflow && (() => {
          const unowned = requiredCards.filter((r) => !state.marketOwned.includes(r.name));
          const totalLamports = unowned.reduce((sum, r) => sum + (r.price ? Number(r.price) : 0), 0);
          const totalSol = totalLamports > 0 ? (totalLamports / 1_000_000_000).toFixed(3) : null;
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wide">
                  Required skills · <span className={allRequiredOwned ? "text-green-400" : "text-amber-300"}>{ownedRequiredCount}/{requiredCards.length} collected</span>
                </p>
                {unowned.length > 0 && (
                  <LockedGate reason="buy" onUnlocked={() => { haptics.strong(); send({ type: "buyRequiredSkills", items: unowned.map((r) => ({ skillId: r.id, creatorWallet: r.creator })) }); }}>
                    <button
                      type="button"
                      onClick={() => { haptics.strong(); send({ type: "buyRequiredSkills", items: unowned.map((r) => ({ skillId: r.id, creatorWallet: r.creator })) }); }}
                      className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-zinc-900 active:bg-amber-300"
                    >
                      Collect all {unowned.length}{totalSol ? ` · ${totalSol} SOL` : ""}
                    </button>
                  </LockedGate>
                )}
              </div>
              <div className="space-y-2">
                {requiredCards.map((req) => {
                  const reqOwned = state.marketOwned.includes(req.name);
                  return (
                    <button
                      key={req.id}
                      type="button"
                      onClick={() => onOpenSkill?.(req)}
                      className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left active:opacity-80 ${reqOwned ? "bg-zinc-900 border-zinc-800" : "bg-zinc-900/40 border-dashed border-amber-500/40"}`}
                    >
                      {/* collection checkbox: filled green check when owned, empty slot when missing */}
                      {reqOwned ? (
                        <span className="shrink-0 grid h-5 w-5 place-items-center rounded-md bg-green-500/90 text-zinc-950 text-xs font-bold">✓</span>
                      ) : (
                        <span className="shrink-0 h-5 w-5 rounded-md border-2 border-dashed border-amber-500/50" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-medium ${reqOwned ? "text-zinc-200" : "text-zinc-300"}`}>{req.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{req.description}</p>
                      </div>
                      {reqOwned ? (
                        <span className="shrink-0 text-[10px] font-semibold text-green-400">owned</span>
                      ) : req.price ? (
                        <span className="shrink-0 text-[11px] font-medium text-amber-300">{(Number(req.price) / 1_000_000_000).toFixed(3)} SOL</span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-zinc-500">free</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {Array.isArray(notes) && notes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Comments</p>
            {(notes as any[]).map((n: any, i) => (
              <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 p-3.5 text-sm text-zinc-300">
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-zinc-800 bg-zinc-800" aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(n.author ?? "") }} />
                  <span className="font-mono text-xs text-zinc-400">{shortAddr(n.author)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{n.text}</p>
              </div>
            ))}
          </div>
        )}

        {owned && (
          <div className="space-y-2.5">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Leave a comment</p>
            <textarea
              ref={noteInput}
              className="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-3.5 text-base text-zinc-200 leading-relaxed resize-none focus:outline-none focus:border-green-500/50"
              rows={4}
              placeholder="Share your experience…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <input
              className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-3 text-base text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
              placeholder="GitHub link (optional)"
              value={noteGitLink}
              onChange={(e) => setNoteGitLink(e.target.value)}
            />
            <button
              onClick={handleNote}
              disabled={!noteText.trim()}
              className="w-full rounded-xl py-3.5 text-base font-semibold bg-zinc-800 text-zinc-200 disabled:opacity-40 active:bg-zinc-700"
            >
              Post
            </button>
          </div>
        )}
        {!owned && !state.walletAddress && (
          <LockedGate reason="comment" onUnlocked={() => { setResumeComment(true); send({ type: "ownedSkills" }); send({ type: "getSkillDetail", mint: card.id }); }}>
            <button className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-3 text-left text-sm text-zinc-400">
              Connect a wallet to comment
            </button>
          </LockedGate>
        )}
        {!owned && !!state.walletAddress && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-500">Collect this skill before commenting.</p>
        )}
      </div>

      {owned && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pt-8 an-tabbar-inset" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--an-bg-0) 60%, transparent), transparent)" }}>
          {/* pointer-events-auto: the fade wrapper is pointer-events-none (so it can't block
              the list scroll), which otherwise swallows the tap too — see the Buy gate below. */}
          <button onClick={() => { haptics.tap(); send({ type: "disposeSkill", skillId: card.id }); }} className="an-btn an-btn-danger pointer-events-auto">
            Remove Skill
          </button>
        </div>
      )}

      {!owned && disposed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pt-8 an-tabbar-inset" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--an-bg-0) 60%, transparent), transparent)" }}>
          <button onClick={() => { haptics.tap(); send({ type: "reEquipSkill", skillId: card.id }); }} className="an-btn an-btn-green pointer-events-auto">
            Re-equip Skill
          </button>
        </div>
      )}

      {!owned && !disposed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pt-8 an-tabbar-inset" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--an-bg-0) 60%, transparent), transparent)" }}>
          <LockedGate reason="buy" onUnlocked={handleBuy} className="pointer-events-auto">
            <button
              onClick={handleBuy}
              disabled={buying || (isWorkflow && !allRequiredOwned)}
              className="an-btn an-btn-orange"
            >
              {buying
                ? "Buying…"
                : isWorkflow && !allRequiredOwned
                  ? `Collect ${requiredCards.length - ownedRequiredCount} more skill${requiredCards.length - ownedRequiredCount === 1 ? "" : "s"} to buy`
                  : priceSol ? `Buy for ${priceSol} SOL` : "Buy (free)"}
            </button>
          </LockedGate>
        </div>
      )}
    </div>
  );
}
