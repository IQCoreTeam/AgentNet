import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseGithubLink, safeExternalUrl } from "@iqlabs-official/agent-sdk/links/github.js";
import { useStore } from "../state/store";
import type { AgentProfile, SkillCard } from "../transport/protocol";
import { AgentIcon } from "../icons";
import { walletAvatarSvg } from "./walletAvatar";
import { PostCelebration } from "./PostCelebration";
import { RegisterWorkRepo } from "../onboarding/RegisterWorkRepo";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function RepoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 2.5Z" />
    </svg>
  );
}

// One verified-work repo row: owner/name, linked-skill count, cached star count, opens the
// repo. Shared by the profile's top-5 list and the "show all" modal.
function VerifiedRepoRow({ repo }: { repo: NonNullable<AgentProfile["verifiedRepos"]>[number] }) {
  return (
    <a
      href={safeExternalUrl(repo.url) ?? repo.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-xl border px-3 py-2.5 active:opacity-80"
      style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-xs" style={{ color: "var(--an-fg)" }}>{repo.owner}/{repo.name}</p>
        <p className="text-[10px]" style={{ color: "var(--an-fg-mute)" }}>
          {repo.skillMints.length} skill{repo.skillMints.length !== 1 ? "s" : ""} linked
        </p>
      </div>
      <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs" style={{ color: "var(--an-fg-dim)" }}>
        <StarIcon className="h-3.5 w-3.5" /> {repo.stars}
      </span>
    </a>
  );
}

// One reusable note editor for both the blog modal (self) and the inline comment box
// (holders). Keeps its own draft; the parent owns the actual postAgentNote + success.
function NoteComposer({
  placeholder,
  submitLabel,
  posting,
  disabled,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  posting?: boolean;
  disabled?: boolean;
  onSubmit: (text: string, gitLink?: string) => void;
}) {
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const busy = posting || disabled;
  function submit() {
    if (!text.trim() || busy) return;
    onSubmit(text.trim(), link.trim() || undefined);
    setText("");
    setLink("");
  }
  return (
    <div className="space-y-2">
      <textarea
        className="w-full resize-none rounded-xl p-2.5 text-sm focus:outline-none"
        style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg)" }}
        rows={3}
        placeholder={placeholder}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        className="w-full rounded-xl px-2.5 py-2 text-sm focus:outline-none"
        style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg-dim)" }}
        placeholder="GitHub link (optional)"
        value={link}
        disabled={busy}
        onChange={(e) => setLink(e.target.value)}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || busy}
        className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
        style={{ background: "var(--an-green)", color: "var(--an-on-green)" }}
      >
        {posting ? "Posting..." : submitLabel}
      </button>
    </div>
  );
}

// Bottom-sheet modal portaled to <body> so it escapes the app's swipe transforms and the
// bottom nav (a `position: fixed` inside a transformed ancestor mis-anchors and overflows).
// Fixed header + scrollable body, capped at 85vh. Tokens only.
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} aria-hidden="true" />
      <div
        className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border sm:max-w-md sm:rounded-2xl"
        style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--an-line)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--an-fg)" }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-1 p-1" style={{ color: "var(--an-fg-mute)" }}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Compact GitHub-token prompt for the repo modal (no token yet). Replaces embedding the
// full onboarding ConnectGithub/OnboardingShell, which is a full-screen layout that
// overflowed inside a sheet. Once saved, githubStatus flips and RegisterWorkRepo shows.
function GithubTokenForm() {
  const { send } = useStore();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  function save() {
    if (!token.trim()) return;
    setSaving(true);
    send({ type: "submitGithubToken", token: token.trim() });
    setTimeout(() => setSaving(false), 1200);
  }
  return (
    <div className="space-y-2.5">
      <p className="text-xs leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>
        Add a GitHub token (repo scope) to register your work. We commit a public
        <span className="font-mono" style={{ color: "var(--an-fg)" }}> .agentnet </span>
        marker (your wallet address only) to prove ownership.
      </p>
      <a
        href="https://github.com/settings/tokens/new?scopes=repo&description=AgentNet"
        target="_blank"
        rel="noreferrer"
        className="block text-xs font-medium"
        style={{ color: "var(--an-green)" }}
      >
        Create a token on GitHub
      </a>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_..."
        className="w-full rounded-xl px-2.5 py-2.5 font-mono text-sm focus:outline-none"
        style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg)" }}
      />
      <button
        onClick={save}
        disabled={!token.trim() || saving}
        className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
        style={{ background: "var(--an-green)", color: "var(--an-on-green)" }}
      >
        {saving ? "Saving..." : "Save token"}
      </button>
    </div>
  );
}

interface Props {
  profile: AgentProfile;
  onBack: () => void;
  onOpenSkill: (card: SkillCard) => void;
}

export function AgentProfileView({ profile, onBack, onOpenSkill }: Props) {
  const { state, send } = useStore();
  const [buyingAll, setBuyingAll] = useState(false);
  const blogDrag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [copied, setCopied] = useState(false);
  const avatar = useMemo(() => walletAvatarSvg(profile.wallet), [profile.wallet]);
  const [fabOpen, setFabOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<null | "blog" | "repo">(null);
  const [posting, setPosting] = useState(false);
  const [celebrate, setCelebrate] = useState<{ label: string } | null>(null);
  const [showAllRepos, setShowAllRepos] = useState(false);
  const awaitingPost = useRef(false);
  const lastToast = useRef(state.toast);
  const lastRepoAt = useRef(state.workRepoResult?.at ?? 0);

  function handleBuyAll() {
    setBuyingAll(true);
    send({ type: "buyAllSkills", wallet: profile.wallet });
    setTimeout(() => setBuyingAll(false), 8000);
  }

  // Post a blog entry (self) or a comment (holder). Success is detected via the store's
  // "Note posted." toast (see below), which then fires the celebration + haptic.
  function submitNote(text: string, gitLink?: string) {
    if (!text.trim() || (!profile.self && !profile.canComment)) return;
    awaitingPost.current = true;
    setPosting(true);
    send({ type: "postAgentNote", agentWallet: profile.wallet, text: text.trim(), gitLink });
  }

  // Blog/comment success: the reducer sets toast "Note posted." on agentNoteResult.ok.
  useEffect(() => {
    if (state.toast === lastToast.current) return;
    lastToast.current = state.toast;
    if (!awaitingPost.current) return;
    if (state.toast === "Note posted.") {
      awaitingPost.current = false;
      setPosting(false);
      setComposeMode(null);
      setCelebrate({ label: "Posted to AgentNet" });
    } else if (typeof state.toast === "string" && state.toast.startsWith("Note failed")) {
      awaitingPost.current = false;
      setPosting(false);
    }
  }, [state.toast]);

  // Verified-repo registration success: the modal's step view shows the result; here we
  // just buzz, then after a beat refresh the profile (so the new repo + stars appear) and
  // close the modal. No celebration overlay - that would be a second success alert.
  useEffect(() => {
    const r = state.workRepoResult;
    if (!r || r.at === lastRepoAt.current) return;
    lastRepoAt.current = r.at;
    if (r.ok) {
      // Let the modal's steps flip to checks, then close it and pop the success as a
      // SEPARATE centered celebration popup (it vibrates on mount) + refresh so the new
      // repo and stars show on the profile.
      const t = setTimeout(() => {
        setComposeMode(null);
        setCelebrate({ label: `Registered ${r.repo ?? "your repo"}` });
        send({ type: "getAgentProfile", wallet: profile.wallet });
      }, 900);
      return () => clearTimeout(t);
    }
  }, [state.workRepoResult]);

  // Fetch GitHub status when the repo modal opens so it can switch from the token prompt
  // to the repo picker once a token exists.
  useEffect(() => {
    if (composeMode === "repo") send({ type: "getGithubStatus" });
  }, [composeMode]);

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
  const verifiedRepos = profile.verifiedRepos ?? [];
  const repoStars = verifiedRepos.reduce((sum, r) => sum + (r.stars ?? 0), 0);
  const sortedRepos = [...verifiedRepos].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  const showBuyAll = !profile.self && allSkills.length > 0;
  const blogNotes = (profile.notes ?? []).filter((n) => n.isSelfNote);
  const comments = (profile.notes ?? []).filter((n) => !n.isSelfNote);
  const canPost = profile.self || profile.canComment;

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
    <div className="relative flex flex-col h-full" style={{ background: "var(--an-bg-0)" }}>
      <header
        className="flex items-center gap-2 border-b px-3 py-2 shrink-0"
        style={{ borderColor: "var(--an-line)", background: "var(--an-bg-1)" }}
      >
        <button onClick={onBack} aria-label="Back" className="px-1 text-lg" style={{ color: "var(--an-fg-dim)" }}>←</button>
        <span className="font-mono text-sm truncate" style={{ color: "var(--an-fg-dim)" }}>{shortWallet(profile.wallet)}</span>
      </header>

      <div className={`flex-1 overflow-y-auto p-3 space-y-4 ${showBuyAll ? "" : "an-tabbar-inset"}`}>
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
              {repoStars > 0 && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--an-green-dim)", color: "var(--an-green)", border: "1px solid var(--an-green-line)" }}
                >
                  <StarIcon className="h-2.5 w-2.5" /> {repoStars}
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

        {/* Verified work - registered GitHub repos + cached stars (summed = reputation score) */}
        {verifiedRepos.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Verified work</p>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--an-green-dim)", border: "1px solid var(--an-green-line)", color: "var(--an-green)" }}
              >
                <StarIcon className="h-3 w-3" /> {repoStars}
              </span>
            </div>
            <div className="space-y-2">
              {sortedRepos.slice(0, 5).map((r) => (
                <VerifiedRepoRow key={`${r.owner}/${r.name}`} repo={r} />
              ))}
            </div>
            {sortedRepos.length > 5 && (
              <button
                onClick={() => setShowAllRepos(true)}
                className="mt-2 w-full rounded-xl border py-2 text-xs font-medium"
                style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)", color: "var(--an-fg-dim)" }}
              >
                Show all {sortedRepos.length}
              </button>
            )}
          </div>
        )}

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

        {/* Comment composer - holders only. Self writes blog posts via the FAB instead. */}
        {!profile.self && (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Write a comment</p>
            {canPost ? (
              <NoteComposer
                placeholder="Share your experience with this agent..."
                submitLabel="Comment"
                posting={posting}
                onSubmit={submitNote}
              />
            ) : (
              <p
                className="rounded-xl px-2.5 py-2 text-[11px]"
                style={{ background: "var(--an-bg-1)", border: "1px solid var(--an-line)", color: "var(--an-fg-mute)" }}
              >
                Hold a skill to comment.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Buy all footer */}
      {showBuyAll && (
        <div className="shrink-0 border-t border-zinc-800 p-3 an-tabbar-inset">
          <button
            onClick={handleBuyAll}
            disabled={buyingAll}
            className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white active:bg-green-500 disabled:opacity-50"
          >
            {buyingAll ? "Buying..." : `Buy all ${allSkills.length} skill${allSkills.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* Compose FAB (self): write a blog post or register verified GitHub work */}
      {profile.self && (
        <>
          {fabOpen && (
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Close menu"
              onClick={() => setFabOpen(false)}
            />
          )}
          <div className="absolute right-5 z-40 flex flex-col items-end gap-3" style={{ bottom: "calc(var(--tabbar-height, 0px) + 1.25rem)" }}>
            {fabOpen && (
              <>
                <button
                  onClick={() => { setFabOpen(false); setComposeMode("repo"); }}
                  className="flex items-center gap-3 rounded-full pl-5 pr-6 text-sm font-semibold shadow-lg"
                  style={{ minHeight: 52, background: "var(--an-bg-1)", border: "1px solid var(--an-line)", color: "var(--an-fg)" }}
                >
                  <RepoIcon className="h-5 w-5" /> Register GitHub work
                </button>
                <button
                  onClick={() => { setFabOpen(false); setComposeMode("blog"); }}
                  className="flex items-center gap-3 rounded-full pl-5 pr-6 text-sm font-semibold shadow-lg"
                  style={{ minHeight: 52, background: "var(--an-bg-1)", border: "1px solid var(--an-line)", color: "var(--an-fg)" }}
                >
                  <PenIcon className="h-5 w-5" /> Write blog
                </button>
              </>
            )}
            <button
              onClick={() => setFabOpen((o) => !o)}
              aria-label="Create"
              className="flex h-16 w-16 items-center justify-center rounded-full shadow-xl"
              style={{ background: "var(--an-green)", color: "var(--an-on-green)", transform: fabOpen ? "rotate(45deg)" : "none", transition: "transform 150ms" }}
            >
              <PlusIcon className="h-7 w-7" />
            </button>
          </div>
        </>
      )}

      {composeMode === "blog" && (
        <Modal title="Write a blog post" onClose={() => setComposeMode(null)}>
          <NoteComposer
            placeholder="Write a blog post or update..."
            submitLabel="Post to AgentNet"
            posting={posting}
            onSubmit={submitNote}
          />
        </Modal>
      )}

      {composeMode === "repo" && (
        <Modal title="Register GitHub work" onClose={() => setComposeMode(null)}>
          {state.githubStatus?.hasToken ? <RegisterWorkRepo /> : <GithubTokenForm />}
        </Modal>
      )}

      {showAllRepos && (
        <Modal title="Verified work" onClose={() => setShowAllRepos(false)}>
          <div className="space-y-2">
            {sortedRepos.map((r) => (
              <VerifiedRepoRow key={`${r.owner}/${r.name}`} repo={r} />
            ))}
          </div>
        </Modal>
      )}

      {celebrate && <PostCelebration label={celebrate.label} onDone={() => setCelebrate(null)} />}
    </div>
  );
}
