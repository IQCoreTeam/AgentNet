import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { parseGithubLink, safeExternalUrl } from "@iqlabs-official/agent-sdk/links/github.js";
import { useStore } from "../state/store";
import type { AgentProfile, SkillCard } from "../transport/protocol";
import { AgentIcon } from "../icons";
import { walletAvatarSvg } from "./walletAvatar";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

interface Props {
  profile: AgentProfile;
  onBack: () => void;
  onOpenSkill: (card: SkillCard) => void;
}

export function AgentProfileView({ profile, onBack, onOpenSkill }: Props) {
  const { send } = useStore();
  const [noteText, setNoteText] = useState("");
  const [buyingAll, setBuyingAll] = useState(false);
  const [noteGitLink, setNoteGitLink] = useState("");
  const blogDrag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [copied, setCopied] = useState(false);
  const avatar = useMemo(() => walletAvatarSvg(profile.wallet), [profile.wallet]);

  function handleBuyAll() {
    setBuyingAll(true);
    send({ type: "buyAllSkills", wallet: profile.wallet });
    setTimeout(() => setBuyingAll(false), 8000);
  }

  function handleNote() {
    if (!noteText.trim() || (!profile.self && !profile.canComment)) return;
    send({
      type: "postAgentNote",
      agentWallet: profile.wallet,
      text: noteText.trim(),
      gitLink: noteGitLink.trim() || undefined,
    });
    setNoteText("");
    setNoteGitLink("");
  }

  function copyWallet() {
    try {
      navigator.clipboard?.writeText(profile.wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard may be unavailable in the webview; ignore
    }
  }

  const allSkills = [...(profile.createdSkills ?? [])];
  const blogNotes = (profile.notes ?? []).filter((n) => n.isSelfNote);
  const comments = (profile.notes ?? []).filter((n) => !n.isSelfNote);
  const canPost = profile.self || profile.canComment;
  const composeTitle = profile.self ? "Post to blog" : "Write a comment";
  const composePlaceholder = profile.self ? "Write a blog post or update..." : "Share your experience with this agent...";

  function shortWallet(wallet?: string) {
    return wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "?";
  }

  function noteDate(timestamp?: number) {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "";
    }
  }

  function GithubCard({ url }: { url: string }) {
    const info = parseGithubLink(url);
    if (!info) {
      const safe = safeExternalUrl(url);
      return safe ? (
        <a href={safe} target="_blank" rel="noreferrer" className="text-blue-400 text-[10px] mt-1 block truncate">{safe}</a>
      ) : null;
    }

    const kind = info.kind === "pull" ? "PR" : info.kind === "blob" ? "File" : info.kind === "commit" ? "Commit" : "Repo";
    return (
      <a
        href={info.href}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block rounded-md border border-zinc-700/80 bg-zinc-950/70 px-2.5 py-2 active:bg-zinc-900"
      >
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-blue-300">{kind}</span>
        <span className="mt-0.5 block truncate text-[11px] font-medium text-zinc-100">{info.label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{info.meta}</span>
      </a>
    );
  }

  function onBlogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.currentTarget.scrollBy({ left: e.key === "ArrowRight" ? 260 : -260, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--an-bg-0)" }}>
      <header
        className="flex items-center gap-2 border-b px-3 py-2 shrink-0"
        style={{ borderColor: "var(--an-line)", background: "var(--an-bg-1)" }}
      >
        <button onClick={onBack} aria-label="Back" className="px-1 text-lg" style={{ color: "var(--an-fg-dim)" }}>←</button>
        <span className="font-mono text-sm truncate" style={{ color: "var(--an-fg-dim)" }}>{shortWallet(profile.wallet)}</span>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Identity hero */}
        <div
          className="flex items-center gap-3 rounded-2xl border p-3"
          style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
        >
          <div
            className="shrink-0 overflow-hidden rounded-2xl border"
            style={{ width: 60, height: 60, background: "var(--an-bg-2)", borderColor: "var(--an-line)" }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: avatar }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm" style={{ color: "var(--an-fg)" }}>{shortWallet(profile.wallet)}</span>
              {profile.self && (
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--an-green-dim)", color: "var(--an-green)", border: "1px solid var(--an-green-line)" }}
                >
                  you
                </span>
              )}
            </div>
            <button
              onClick={copyWallet}
              className="mt-1 inline-flex items-center gap-1 text-[11px]"
              style={{ color: "var(--an-fg-mute)" }}
            >
              <CopyIcon className="h-3 w-3" />
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
        </div>

        {/* Stat plaques */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: profile.createdSkills?.length ?? 0, label: "Created" },
            { n: profile.ownedSkills?.length ?? 0, label: "Owned" },
            { n: profile.reputation?.totalSupply ?? 0, label: "Copies" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border p-3 text-center"
              style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
            >
              <p className="text-xl font-semibold" style={{ color: "var(--an-fg)" }}>{s.n}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Skills grid */}
        {allSkills.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Skills</p>
            <div className="grid grid-cols-2 gap-2">
              {allSkills.map((card) => (
                <button
                  key={card.id}
                  onClick={() => onOpenSkill(card)}
                  className="text-left rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 active:bg-zinc-800"
                >
                  {card.image ? (
                    <img src={card.image} alt="" className="h-8 w-8 rounded-lg object-cover mb-1.5" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 mb-1.5"><AgentIcon className="h-4 w-4" /></div>
                  )}
                  <p className="text-xs font-medium text-zinc-200 truncate">{card.name}</p>
                  <p className="text-[10px] text-zinc-500">{card.price ? `${(Number(card.price) / 1e9).toFixed(3)} SOL` : "free"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Blog */}
        {blogNotes.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Blog</p>
            <div
              className="flex snap-x gap-2 overflow-x-auto pb-2 outline-none [-webkit-overflow-scrolling:touch]"
              tabIndex={0}
              aria-label="Blog posts"
              onKeyDown={onBlogKeyDown}
              onWheel={(e) => {
                if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                e.currentTarget.scrollLeft += e.deltaY;
              }}
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse" || e.button !== 0) return;
                blogDrag.current = { active: true, moved: false, startX: e.clientX, startLeft: e.currentTarget.scrollLeft };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = blogDrag.current;
                if (!drag.active) return;
                const dx = e.clientX - drag.startX;
                if (Math.abs(dx) > 3) drag.moved = true;
                e.currentTarget.scrollLeft = drag.startLeft - dx;
              }}
              onPointerUp={(e) => {
                if (!blogDrag.current.active) return;
                blogDrag.current.active = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                blogDrag.current.active = false;
              }}
              onClickCapture={(e) => {
                if (!blogDrag.current.moved) return;
                e.preventDefault();
                e.stopPropagation();
                blogDrag.current.moved = false;
              }}
            >
              {blogNotes.map((n) => (
                <article key={n.id} className="min-w-[230px] max-w-[260px] flex-[0_0_78%] snap-start rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-xs text-zinc-300 sm:flex-[0_0_240px]">
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{n.text}</p>
                  {n.gitLink && <GithubCard url={n.gitLink} />}
                  {noteDate(n.timestamp) && <p className="mt-2 border-t border-zinc-800 pt-1.5 text-[10px] text-zinc-600">{noteDate(n.timestamp)}</p>}
                </article>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        {comments.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Comments</p>
            <div className="space-y-2">
              {comments.map((n) => (
                <div key={n.id} className="rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-xs text-zinc-300">
                  <p className="text-zinc-600 text-[10px] mb-0.5">{shortWallet(n.author)}</p>
                  <p className="whitespace-pre-wrap break-words">{n.text}</p>
                  {n.gitLink && <GithubCard url={n.gitLink} />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compose */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wide">{composeTitle}</p>
          {!canPost && (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-500">Own at least one of this agent's skills to comment.</p>
          )}
          <textarea
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 text-xs text-zinc-200 resize-none focus:outline-none focus:border-green-500/50"
            rows={2}
            placeholder={composePlaceholder}
            value={noteText}
            disabled={!canPost}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            placeholder="GitHub link (optional)"
            value={noteGitLink}
            disabled={!canPost}
            onChange={(e) => setNoteGitLink(e.target.value)}
          />
          <button
            onClick={handleNote}
            disabled={!noteText.trim() || !canPost}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 disabled:opacity-40 active:bg-zinc-700"
          >
            {profile.self ? "Post" : "Comment"}
          </button>
        </div>
      </div>

      {/* Buy all footer */}
      {!profile.self && allSkills.length > 0 && (
        <div className="shrink-0 border-t border-zinc-800 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={handleBuyAll}
            disabled={buyingAll}
            className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white active:bg-green-500 disabled:opacity-50"
          >
            {buyingAll ? "Buying…" : `Buy all ${allSkills.length} skill${allSkills.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
