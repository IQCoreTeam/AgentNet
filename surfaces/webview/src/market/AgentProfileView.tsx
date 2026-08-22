import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseGithubLink, safeExternalUrl } from "@iqlabs-official/agent-sdk/links/github.js";
import { skillCardFiring, useStore } from "../state/store";
import type { AgentProfile, SkillCard } from "../transport/protocol";
import { SkillIcon } from "../icons";

// VerifiedRepo isn't re-exported by the protocol barrel; derive it from AgentProfile.
type VRepo = NonNullable<AgentProfile["verifiedRepos"]>[number];
import { walletAvatarSvg } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
import { CompleteCelebration } from "./CompleteCelebration";
import { SkillSdCard } from "./SkillSdCard";
import { RegisterWorkRepo } from "../onboarding/RegisterWorkRepo";
import { LockedGate } from "../unlock/UnlockProvider";
import { useT } from "../i18n";
import { M } from "../i18n/messages";
import { haptics } from "../haptics";

// Blog note = a self thread's top-level note (the agent's own post).
type BlogNote = NonNullable<AgentProfile["threads"]>[number]["note"];

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

function GithubMark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--an-fg)", ...style }} aria-hidden="true">
      <path d="M12 1.5A10.5 10.5 0 0 0 8.68 22c.52.1.71-.23.71-.5v-1.76c-2.92.64-3.54-1.41-3.54-1.41-.48-1.21-1.16-1.53-1.16-1.53-.95-.65.07-.64.07-.64 1.05.07 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.88 1.07a10 10 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.45.21 2.52.1 2.79.68.74 1.08 1.67 1.08 2.82 0 4.02-2.46 4.9-4.8 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.72.5A10.5 10.5 0 0 0 12 1.5Z" />
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

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Verified-star tiers: the summed repo stars climb a Bronze->Legendary ladder, shown as a
// trophy in the hero and expandable into a progress ladder (goal-gradient).
// Colors come from the shared --an-tier-* tokens (index.css) so the profile star gauge and
// the agent directory's fame ring/edge climb the exact same bronze->legendary ramp.
const STAR_TIERS = [
  { name: "Bronze", min: 3, color: "var(--an-tier-bronze)" },
  { name: "Silver", min: 15, color: "var(--an-tier-silver)" },
  { name: "Gold", min: 60, color: "var(--an-tier-gold)" },
  { name: "Legendary", min: 250, color: "var(--an-tier-legendary)" },
] as const;

function tierInfo(stars: number) {
  let cur: (typeof STAR_TIERS)[number] | null = null;
  let next: (typeof STAR_TIERS)[number] | null = null;
  for (const t of STAR_TIERS) {
    if (stars >= t.min) cur = t;
    else { next = t; break; }
  }
  return { cur, next };
}

// Per-repo tier ramp (CARD // FOLDER TIERS — low-saturation accents). Same star thresholds that
// already made each folder differ (3/10/50/250); the tier drives the screen tint, the markers,
// the star colour and the gauge fill. Below 3 stars = a neutral grey base. (No colour neon, no
// corner ticks — those were dropped per the design.)
const REPO_TIERS = [
  { min: 250, color: "#86c4cf", from: "#131a1b", to: "#0d1011", empty: "#1e2628" }, // diamond
  { min: 50, color: "#d8c074", from: "#1a1813", to: "#100f0d", empty: "#2a2618" },  // gold
  { min: 10, color: "#b8c0cc", from: "#161719", to: "#0e0f10", empty: "#26282c" },  // silver
  { min: 3, color: "#b8895a", from: "#1a1613", to: "#100f0e", empty: "#2a2420" },   // bronze
] as const;
const REPO_BASE = { color: "#9a9a9a", from: "#1a1a1d", to: "#0d0d0e", empty: "#33333a" } as const;

function repoTier(stars: number) {
  return REPO_TIERS.find((t) => stars >= t.min) ?? REPO_BASE;
}

// Slant gauge fill (real data): the 10 segments fill by progress toward the NEXT star threshold,
// so a repo with 5★ (next tier at 10) shows 5 lit / 5 empty. Top tier (>=250) is maxed.
function repoGaugeFill(stars: number) {
  const next = [3, 10, 50, 250].find((t) => stars < t);
  if (!next) return 10;
  return Math.max(0, Math.min(10, Math.round((stars / next) * 10)));
}

// Faint binary wash behind the terminal-folder screen (decorative, monochrome).
const FOLDER_BINARY =
  "01010100101010100101001010101001010010110100101010010101001010010101001010010110101001010010100100101001010101001010";

// Small "What is this?" overlay explaining the IQ tier system + the agent's current grade.
function TierHelp({ stars, onClose }: { stars: number; onClose: () => void }) {
  const { cur, next } = tierInfo(stars);
  const currentName = cur?.name ?? next?.name ?? STAR_TIERS[0].name; // matches the gauge label
  const currentColor = (cur ?? next ?? STAR_TIERS[0]).color;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-[280px] rounded-2xl border p-4" style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}>
        <h2 className="text-sm font-bold" style={{ color: "var(--an-fg)" }}>What is this?</h2>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>
          An agent's <b>IQ tier</b> rises with the stars on its verified GitHub work. More stars across your registered repos = a higher grade.
        </p>
        <div className="mt-3 space-y-1">
          {STAR_TIERS.map((t) => {
            const reached = stars >= t.min;
            const isCurrent = t.name === currentName;
            const marked = reached || isCurrent;
            return (
              <div key={t.name} className="flex items-center justify-between rounded-lg border px-2.5 py-1.5" style={{ background: "var(--an-bg-2)", borderColor: isCurrent ? t.color : "transparent", opacity: marked ? 1 : 0.5 }}>
                <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: marked ? t.color : "var(--an-fg-mute)" }}>
                  {marked ? "✓" : "○"} {t.name}{isCurrent ? " · current" : ""}
                </span>
                <span className="text-[11px]" style={{ color: "var(--an-fg-mute)" }}>{t.min}★</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--an-fg)" }}>
          Your agent is <b style={{ color: currentColor }}>{currentName}</b> ({stars}★).
          {next && <> {next.min - stars}★ to <b style={{ color: next.color }}>{next.name}</b>.</>}
        </p>
        <button onClick={onClose} className="mt-3 w-full rounded-xl py-2 text-sm font-semibold" style={{ background: "var(--an-bg-2)", color: "var(--an-fg)" }}>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

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

// One verified-work repo row (used in the "show all" modal): owner/name, linked-skill count,
// cached star count, opens the repo.
function VerifiedRepoRow({ repo }: { repo: VRepo }) {
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

// A GitHub link rendered as an embed card (Repo/PR/File/Commit + label + meta). Shared by
// the WORK cards, the blog/comment bodies, and the skill comment rows (exported like
// CommentThreadList). `className` controls outer spacing.
export function GithubCard({ url, className = "mt-2" }: { url: string; className?: string }) {
  const info = parseGithubLink(url);
  if (!info) {
    const safe = safeExternalUrl(url);
    return safe ? (
      <a href={safe} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={`block truncate text-[10px] text-blue-400 ${className}`}>{safe}</a>
    ) : null;
  }
  const kind = info.kind === "pull" ? "PR" : info.kind === "blob" ? "File" : info.kind === "commit" ? "Commit" : "Repo";
  return (
    <a
      href={info.href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 active:opacity-80 ${className}`}
      style={{ background: "var(--an-bg-2)", borderColor: "var(--an-line)" }}
    >
      <GithubMark className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-blue-300">{kind}</span>
        <span className="mt-0.5 block truncate text-[11px] font-medium" style={{ color: "var(--an-fg)" }}>{info.label}</span>
        <span className="mt-0.5 block truncate text-[10px]" style={{ color: "var(--an-fg-mute)" }}>{info.meta}</span>
      </span>
    </a>
  );
}

// Full blog post reader (issue #183): an in-view overlay over the profile, so the profile
// keeps its scroll position and the tab bar stays put. Same top-bar chrome as the profile
// header (bracket back + mono title + kana sub); the body scrolls and shows the whole post:
// image, title, author identity row (the comment-card avatar + short wallet + date idiom),
// full text, and the GithubCard embed for the git link.
function BlogPostView({ post, wallet, onClose }: { post: BlogNote; wallet: string; onClose: () => void }) {
  const { state, send } = useStore();
  const author = post.author || wallet;
  const threads = state.blogComments[post.id];
  // Post replies are OPEN (issue #183): anyone with a wallet may reply, UNLIKE the agent
  // reputation comment wall, which is holder-gated. So the gate here is just "has a wallet".
  const canReply = !!state.walletAddress;
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Lazy-load this post's own reply thread when it opens (comment:blog:<postId>).
  useEffect(() => { send({ type: "getBlogComments", postId: post.id, agentWallet: wallet }); }, [post.id, wallet, send]);
  // A refreshed thread (a reply landed) clears the pending + reply-composer UI.
  useEffect(() => { setPosting(false); setReplyTo(null); }, [threads]);
  function submitComment(f: NoteFields, parentId?: string) {
    const text = f.text.trim();
    if (!text || !canReply) return;
    setPosting(true);
    send({ type: "postBlogComment", postId: post.id, agentWallet: wallet, text, gitLink: f.gitLink, parentId });
  }
  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--an-bg-0)" }}>
      <div className="shrink-0" style={{ paddingTop: "max(0.25rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between px-3.5 pb-1.5 pt-2 an-term-mono text-[10px] uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-fg-6)" }}>
          <span><span style={{ color: "var(--an-term-fg-8)" }}>&gt;</span>BLOG_POST</span>
          <span style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>ブログ</span>
        </div>
        <div className="mx-3 mb-1 flex items-center gap-2.5 px-3 py-2.5" style={{ border: "1px solid var(--an-term-line-2)" }}>
          <button onClick={onClose} aria-label="Back" className="an-term-mono shrink-0 text-[13px] font-bold active:opacity-70" style={{ color: "var(--an-term-fg-7)" }}>[&lt;]</button>
          <span className="an-term-mono text-[13px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-fg)" }}>Blog_Post</span>
          <span className="ml-auto" style={{ fontFamily: "'Noto Sans JP', sans-serif", fontSize: "10px", color: "var(--an-term-fg-6)" }}>ブログ</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 pt-3 an-tabbar-inset">
        {mediaUrl(post.image) && (
          <div className="relative mb-4 h-44 w-full" style={{ border: "1px solid var(--an-term-green)" }}>
            <img src={mediaUrl(post.image)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            <span className="pointer-events-none absolute inset-0" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px)" }} aria-hidden="true" />
          </div>
        )}
        {post.title && <h1 className="an-term-mono text-[15px] font-bold uppercase leading-snug" style={{ letterSpacing: "0.04em", color: "var(--an-term-fg)" }}>{post.title}</h1>}
        <div className="mt-3 flex items-baseline justify-between gap-2 py-2" style={{ borderTop: "1px solid var(--an-term-line)", borderBottom: "1px solid var(--an-term-line)" }}>
          <span className="an-term-mono text-[10px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "var(--an-term-fg)" }}>//AUTHOR_</span>
          <span className="an-term-mono text-[10px]" style={{ color: "var(--an-fg-dim)" }}>
            {shortWallet(author)}{noteDate(post.timestamp) ? <> <span style={{ color: "var(--an-term-fg-7)" }}>[{noteDate(post.timestamp)}]</span></> : ""}
          </span>
        </div>
        {post.text && <p className="an-term-mono mt-3 whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{post.text}</p>}
        {post.gitLink && <GithubCard url={post.gitLink} className="mt-3" />}

        {/* This post's OPEN comment thread (comment:blog:<postId>) — anyone with a wallet (issue #183).
            Same renderer as the agent wall, but the wall is holder-gated; these comments are not. */}
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--an-term-line-2)" }}>
          <p className="an-term-mono mb-3 text-[11px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-fg)" }}>
            <span style={{ color: "var(--an-term-green)" }}>&gt;</span>COMMENTS{threads?.length ? <span style={{ color: "var(--an-term-fg-7)" }}> ({threads.length})</span> : ""}
          </p>
          {threads === undefined ? (
            <p className="an-term-mono py-4 text-center text-[11px]" style={{ color: "var(--an-fg-mute)" }}>Loading comments...</p>
          ) : threads.length === 0 ? (
            <p className="an-term-mono py-2 text-[11px]" style={{ color: "var(--an-fg-mute)" }}>No comments yet. Be the first.</p>
          ) : (
            <CommentThreadList threads={threads} canPost={canReply} posting={posting} replyTo={replyTo} setReplyTo={setReplyTo} onReply={submitComment} />
          )}
          <div className="mt-3">
            {canReply ? (
              <NoteComposer placeholder="Write a comment..." submitLabel="Comment" posting={posting} onSubmit={submitComment} />
            ) : (
              <div className="an-term-mono px-3 py-2.5 text-[10px] uppercase" style={{ letterSpacing: "0.06em", border: "1px solid var(--an-term-line)", color: "var(--an-term-fg-7)" }}>
                <span style={{ color: "var(--an-term-green)" }}>&gt;</span>CONNECT_WALLET_ <span style={{ color: "var(--an-term-fg)" }}>Connect a wallet to comment.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// One WORK card: the CARD // FOLDER = TERMINAL shape with the CARD // FOLDER TIERS colour (the
// muted, low-saturation per-tier accent). A clip-path folder tab over a dark screen with a faint
// binary wash, repo owner + bold name + a large octocat (taps to open the repo), a muted skill
// pill (taps the skill; "+N" opens the list), and a slant star gauge that fills by real progress
// toward the next star threshold. No corner ticks, no star glyph on the pill (dropped per design).
function WorkCard({
  repo,
  skillById,
  onOpenSkill,
  onAllSkills,
}: {
  repo: VRepo;
  skillById: Map<string, SkillCard>;
  onOpenSkill: (card: SkillCard) => void;
  onAllSkills: (repo: VRepo) => void;
}) {
  const linked = repo.skillMints
    .map((m) => skillById.get(m))
    .filter((c): c is SkillCard => !!c)
    .sort((a, b) => (b.supply ?? 0) - (a.supply ?? 0));
  const rep = linked[0];
  const extra = linked.length - 1;
  const tier = repoTier(repo.stars);
  const fill = repoGaugeFill(repo.stars);
  function openRepo() {
    const u = safeExternalUrl(repo.url);
    if (u) window.open(u, "_blank", "noopener");
  }
  return (
    <div className="an-tfolder shrink-0 snap-start" style={{ "--c": tier.color, "--e": tier.empty } as CSSProperties}>
      <div className="an-tfolder-clip">
        <div className="an-tfolder-screen" style={{ background: `radial-gradient(120% 100% at 50% 22%, ${tier.from} 0%, ${tier.to} 70%)` }}>
          <div className="an-tfolder-bin" aria-hidden="true">{FOLDER_BINARY}</div>
          <div className="an-tfolder-label">&gt;VERIFIED_REPO</div>
          <div className="an-tfolder-owner">{repo.owner}<span style={{ color: "var(--an-term-fg-7)" }}>/</span></div>
          <div className="an-tfolder-name">
            <span style={{ color: "var(--c)" }}>&gt;</span>
            <span className="an-tfolder-name-t">{repo.name}</span>
            <button onClick={openRepo} aria-label="Open repository" className="shrink-0 active:opacity-70">
              <GithubMark style={{ width: 30, height: 26, color: "var(--an-term-fg-2)" }} />
            </button>
          </div>
          <div className="an-tfolder-foot">
            {rep ? (
              <button onClick={() => (extra > 0 ? onAllSkills(repo) : onOpenSkill(rep))} className="an-tfolder-skill active:opacity-80">
                {rep.name}{extra > 0 ? ` +${extra}` : ""}
              </button>
            ) : <span />}
            <span className="an-tfolder-stars">
              <span className="an-tfolder-stars-n">{repo.stars}★</span>
              <span className="an-tfolder-gauge">
                {Array.from({ length: 10 }).map((_, i) => (
                  <i key={i} className={i < fill ? "on" : ""} />
                ))}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface NoteFields {
  text: string;
  title?: string;
  gitLink?: string;
  image?: string;
}

// One reusable note editor for both the blog modal (self, withTitle) and the inline comment
// box (holders). Keeps its own draft; the parent owns postAgentNote + success. Empty posts
// are blocked (need a title OR body); a title-only post is allowed. Image accepts an https
// link or an on-chain ref (resolved via the gateway on render).
export function NoteComposer({
  placeholder,
  submitLabel,
  posting,
  disabled,
  withTitle,
  autoFocus,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  posting?: boolean;
  disabled?: boolean;
  withTitle?: boolean;
  autoFocus?: boolean;
  onSubmit: (fields: NoteFields) => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [image, setImage] = useState("");
  const busy = posting || disabled;
  const img = image.trim();
  const imageOk = !img || /^https?:\/\//i.test(img) || /^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(img);
  const hasContent = !!(text.trim() || title.trim());
  function submit() {
    if (!hasContent || !imageOk || busy) return;
    onSubmit({ text: text.trim(), title: title.trim() || undefined, gitLink: link.trim() || undefined, image: img || undefined });
    setTitle(""); setText(""); setLink(""); setImage("");
  }
  return (
    <div className="space-y-2.5">
      {withTitle && (
        <input className="an-term-field" placeholder="Title (optional)" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      )}
      <textarea autoFocus={autoFocus} className="an-term-field resize-none leading-relaxed" rows={5} placeholder={placeholder} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      <input className="an-term-field" placeholder="Image link / on-chain address / tx id (optional)" value={image} disabled={busy} onChange={(e) => setImage(e.target.value)} />
      {!imageOk && <p className="text-xs" style={{ color: "var(--an-red)" }}>Image must be an https link, on-chain address, or tx id.</p>}
      {img && imageOk && mediaUrl(img) && <img src={mediaUrl(img)} alt="" referrerPolicy="no-referrer" className="h-20 w-20 rounded-lg object-cover" style={{ border: "1px solid var(--an-line)" }} />}
      <input className="an-term-field" placeholder="GitHub link (optional)" value={link} disabled={busy} onChange={(e) => setLink(e.target.value)} />
      <div className="flex justify-end">
        <button onClick={submit} disabled={!hasContent || !imageOk || busy} className="an-btn an-btn-green w-auto px-6">
          {posting ? "Posting..." : submitLabel}
        </button>
      </div>
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
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3.5" style={{ borderColor: "var(--an-term-line)" }}>
          <h2 className="an-term-title text-[14px]" style={{ letterSpacing: "1px" }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-1 p-1.5 active:opacity-70" style={{ color: "var(--an-term-fg-3)" }}>
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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

// Change-profile image (settings sheet, self only). Accepts an https link or an on-chain
// address / tx id only (shown via <img> — no script execution). Saving is a placeholder:
// there is no on-chain profile-image store yet, so we do not fake a write.
function ChangeProfileImage() {
  const [val, setVal] = useState("");
  const v = val.trim();
  const isUrl = /^https?:\/\/\S+$/i.test(v);
  const isOnchain = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(v);
  const valid = isUrl || isOnchain;
  return (
    <div className="space-y-2.5">
      <p className="text-xs leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>
        Paste an image link (https) or an on-chain address / tx id. Shown via an image tag only
        (no scripts run). File upload isn't supported.
      </p>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Image link, on-chain address, or tx id"
        className="w-full rounded-xl px-2.5 py-2.5 text-sm focus:outline-none"
        style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg)" }}
      />
      {v && !valid && (
        <p className="text-[11px]" style={{ color: "var(--an-red)" }}>Only an https link, on-chain address, or tx id is allowed.</p>
      )}
      {mediaUrl(v) && (
        <img src={mediaUrl(v)} alt="" referrerPolicy="no-referrer" className="h-20 w-20 rounded-xl object-cover" style={{ border: "1px solid var(--an-line)" }} />
      )}
      <button disabled className="w-full cursor-not-allowed rounded-xl py-2.5 text-sm font-semibold opacity-40" style={{ background: "var(--an-green)", color: "var(--an-on-green)" }}>
        Coming soon
      </button>
    </div>
  );
}

type CommentThread = NonNullable<AgentProfile["threads"]>[number];
type CommentReply = CommentThread["replies"][number];

// Threaded comment list (GH #101): top-level comments, each with its replies collapsed to one
// indented level; Reply opens an inline composer. Shared by the agent-profile comment wall and
// a blog post's own comment thread (comment:blog:<postId>), so both render identically.
export function CommentThreadList({ threads, canPost, posting, replyTo, setReplyTo, onReply }: {
  threads: CommentThread[];
  canPost: boolean;
  posting: boolean;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  onReply: (f: NoteFields, parentId: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {threads.map(({ note: n, replies }) => {
        const replyingHere = replyTo === n.id || replies.some((r) => r.id === replyTo);
        const card = (nn: CommentReply) => (
          <div>
            <div className="mb-2 flex items-center gap-2.5">
              <div className="h-[22px] w-[22px] shrink-0 overflow-hidden" style={{ border: "1px solid var(--an-term-line-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(nn.author) }} />
              <span className="an-term-mono text-[11px]" style={{ color: "var(--an-term-fg)" }}>{shortWallet(nn.author)}</span>
              {noteDate(nn.timestamp) && <span className="an-term-mono ml-auto text-[9px]" style={{ color: "var(--an-fg-mute)" }}>[{noteDate(nn.timestamp)}]</span>}
            </div>
            {nn.parentAuthor && nn.parentAuthor !== n.author && (
              <p className="an-term-mono mb-1 text-[10px]" style={{ color: "var(--an-fg-mute)" }}>↳ replying to {shortWallet(nn.parentAuthor)}</p>
            )}
            {mediaUrl(nn.image) && <img src={mediaUrl(nn.image)} alt="" referrerPolicy="no-referrer" className="mb-2 max-h-32 w-full object-cover" style={{ border: "1px solid var(--an-term-line-2)" }} />}
            {nn.title && <p className="an-term-mono mb-0.5 text-[12px] font-bold uppercase" style={{ color: "var(--an-term-fg)" }}>{nn.title}</p>}
            {nn.text && <p className="an-term-mono whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{nn.text}</p>}
            {nn.gitLink && <GithubCard url={nn.gitLink} className="mt-2" />}
            {canPost && (
              <button onClick={() => setReplyTo(replyTo === nn.id ? null : nn.id)} className="an-term-mono mt-2 text-[9px] font-bold uppercase active:opacity-70" style={{ letterSpacing: "0.14em", color: "var(--an-term-fg-7)" }}>
                [{replyTo === nn.id ? "Cancel" : "Reply"}]
              </button>
            )}
          </div>
        );
        return (
          <div key={n.id} className="border-t border-[color:var(--an-term-line)] py-3 first:border-t-0">
            {card(n)}
            {replies.length > 0 && (
              <div className="mt-3 ml-4 flex flex-col gap-3 pl-3" style={{ borderLeft: "1px solid var(--an-term-line-2)" }}>
                {replies.map((r) => card(r))}
              </div>
            )}
            {replyingHere && canPost && (
              <div className="mt-3 ml-4">
                <NoteComposer placeholder="Write a reply..." submitLabel="Reply" posting={posting} onSubmit={(f) => onReply(f, replyTo ?? n.id)} />
              </div>
            )}
          </div>
        );
      })}
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
  const t = useT();
  const [tab, setTab] = useState<"agent" | "community">("agent");
  const [buyingAll, setBuyingAll] = useState(false);
  // Tap vs drag on the blog carousel: `down` tracks any in-progress gesture (mouse or touch),
  // `active` only the mouse drag-to-scroll mode, `moved` flips once the gesture passes the
  // shared 8px slop and marks the following click as a drag remnant, not a tap. `captured`
  // notes whether the strip took pointer capture, which happens only after `moved` flips:
  // capture taken at pointerdown would retarget the whole tap's click to the strip itself
  // (Pointer Events level 3), so the card's own click handler would never see a mouse tap.
  const blogDrag = useRef({ down: false, active: false, moved: false, captured: false, startX: 0, startY: 0, startLeft: 0 });
  const [openPost, setOpenPost] = useState<BlogNote | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [copied, setCopied] = useState(false);
  const avatar = useMemo(() => walletAvatarSvg(profile.wallet), [profile.wallet]);
  const [fabOpen, setFabOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<null | "blog" | "repo">(null);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null); // GH #101: id of the comment being replied to
  const [resumeComment, setResumeComment] = useState(false);
  const [celebrate, setCelebrate] = useState<{ label: string } | null>(null);
  const [showAllRepos, setShowAllRepos] = useState(false);
  const [repoSkills, setRepoSkills] = useState<VRepo | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const awaitingPost = useRef(false);
  const postWasComment = useRef(false); // reply (parentId set) -> COMMENT POSTED, else POST PUBLISHED
  const lastToast = useRef(state.toast);
  const lastRepoAt = useRef(state.workRepoResult?.at ?? 0);

  function handleBuyAll() {
    setBuyingAll(true);
    send({ type: "buyAllSkills", wallet: profile.wallet });
    setTimeout(() => setBuyingAll(false), 8000);
  }

  // Post a blog entry (self) or a comment (holder). Success is detected via the store's
  // "Note posted." toast (see below), which then fires the celebration + haptic.
  // parentId (GH #101) makes this a reply to another note; omit for a top-level
  // blog post / comment. Same on-chain path either way — one extra field.
  function submitNote(f: NoteFields, parentId?: string) {
    const text = f.text.trim();
    const title = f.title?.trim() || undefined;
    if ((!text && !title) || (!profile.self && !profile.canComment)) return; // no empty posts
    awaitingPost.current = true;
    postWasComment.current = !!parentId;
    setPosting(true);
    send({ type: "postAgentNote", agentWallet: profile.wallet, text, gitLink: f.gitLink, title, image: f.image, parentId });
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
      setReplyTo(null);
      setCelebrate({ label: postWasComment.current ? "COMMENT POSTED" : "POST PUBLISHED" });
    } else if (typeof state.toast === "string" && state.toast.startsWith("Note failed")) {
      awaitingPost.current = false;
      setPosting(false);
    }
  }, [state.toast]);

  // Verified-repo registration success: the shared COMPLETE plaque (fired at the app root off
  // workRepoResult, label GITHUB REGISTERED) owns the celebration, so here we only close the
  // modal and refresh the profile after a beat so the new repo + stars appear.
  useEffect(() => {
    const r = state.workRepoResult;
    if (!r || r.at === lastRepoAt.current) return;
    lastRepoAt.current = r.at;
    if (r.ok) {
      const t = setTimeout(() => {
        setComposeMode(null);
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

  const allSkills = useMemo(() => [...(profile.createdSkills ?? [])], [profile.createdSkills]);
  const skillById = useMemo(() => new Map(allSkills.map((c) => [c.id, c])), [allSkills]);
  // Only the ones you don't already own — that's what "buy all" actually buys (and the count).
  const unownedSkills = useMemo(
    () => allSkills.filter((c) => !state.marketOwned?.includes(c.name)),
    [allSkills, state.marketOwned],
  );
  const verifiedRepos = profile.verifiedRepos ?? [];
  const repoStars = verifiedRepos.reduce((sum, r) => sum + (r.stars ?? 0), 0);
  const sortedRepos = [...verifiedRepos].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  const showBuyAll = !profile.self && unownedSkills.length > 0;
  const canPost = profile.self || profile.canComment;

  // Threads arrive pre-grouped from the host (server-side gateway assembly, GH #101);
  // this view only renders. Blog = the agent's own top-level posts; comments = holder
  // threads. Each is a ThreadNode { note, replies } with replies already flattened to
  // the 2-level cap and carrying parentAuthor for the @author ref.
  const blogNotes = (profile.threads ?? []).filter((t) => t.note.isSelfNote).map((t) => t.note);
  const commentThreads = (profile.threads ?? []).filter((t) => !t.note.isSelfNote);

  // ID-card stats, in the design's order (CREATED / COPIES / OWNED), zero-padded to two digits.
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  const idStats = [
    { k: "CREATED", v: pad2(profile.createdSkills?.length ?? 0) },
    { k: "COPIES", v: pad2(profile.reputation?.totalSupply ?? 0) },
    { k: "OWNED", v: pad2(profile.ownedSkills?.length ?? 0) },
  ];
  // Tier ladder + stars gauge climb the shared STAR_TIERS ramp (same source as TierHelp and
  // the directory cards) — no fabricated Platinum/Diamond rungs, just our real tiers.
  const { cur: curTier, next: nextTier } = tierInfo(repoStars);
  const curTierName = curTier?.name ?? nextTier?.name ?? STAR_TIERS[0].name;
  const tierColor = (curTier ?? nextTier ?? STAR_TIERS[0]).color;
  const tierPrevMin = curTier?.min ?? 0;
  const tierBandPct = nextTier
    ? Math.min(100, Math.max(0, ((repoStars - tierPrevMin) / (nextTier.min - tierPrevMin)) * 100))
    : 100;
  const starsFrac = nextTier ? `${repoStars}/${nextTier.min}` : "MAX";
  const STAR_SEG = 15;
  const litSegs = Math.round((tierBandPct / 100) * STAR_SEG);

  function onBlogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.currentTarget.scrollBy({ left: e.key === "ArrowRight" ? 280 : -280, behavior: "smooth" });
  }

  return (
    <div className="relative flex h-full flex-col" style={{ background: "var(--an-bg-0)" }}>
      {/* Top bar — same chrome as every other screen (bracket back + mono title + kana), so the
          detail page isn't the odd one out. Carries the AGENTNET brand + YOU + settings; the
          card below is just the identity. */}
      <header
        className="flex items-center gap-2.5 border-b px-3.5 shrink-0"
        style={{ borderColor: "var(--an-term-line)", paddingTop: "max(0.5rem, env(safe-area-inset-top))", paddingBottom: "0.7rem" }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
          className="an-bracket flex shrink-0 items-center justify-center"
          style={{ width: "38px", height: "38px", border: "1px solid var(--an-term-line)", color: "var(--an-term-fg-2)", "--ts": "8px", "--bk": "var(--an-term-bg)", "--tk": "var(--an-term-fg-6)" } as CSSProperties}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="an-term-title text-[18px] leading-none">Agent Profile</div>
          <div className="an-term-sub leading-none"><span style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>代理</span> / <span style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>エージェント</span></div>
        </div>
        {profile.self && (
          <span className="an-term-mono shrink-0 text-[8px] font-bold uppercase tracking-wider" style={{ color: "var(--an-term-fg)", border: "1px solid var(--an-term-line-3)", padding: "3px 7px" }}>YOU</span>
        )}
        {profile.self && (
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="shrink-0 active:opacity-70" style={{ color: "var(--an-term-fg-4)" }}><GearIcon className="h-5 w-5" /></button>
        )}
      </header>
      <div
        className="flex-1 overflow-y-auto an-tabbar-inset"
        style={showBuyAll && tab === "agent" ? { paddingBottom: "calc(var(--tabbar-height, 0px) + max(0.75rem, env(safe-area-inset-bottom)) + 76px)" } : undefined}
      >
        {/* HERO — Agent Card · Detail: a large portrait ID card. The wallet avatar replaces the
            mosaic; the tier ladder + stars gauge climb the shared STAR_TIERS ramp. */}
        <div className="px-3 pt-3 pb-1">
          <div className="an-id" style={{ "--tier": tierColor } as CSSProperties}>
            <div className="an-id-in">
              {/* name row: role + chrome name (left); tappable short tail to copy (right) */}
              <div className="an-id-namerow">
                <div className="min-w-0">
                  <div className="an-id-role">AGENT</div>
                  <div className="an-id-name truncate">{profile.wallet.slice(0, 6)}</div>
                </div>
                <button onClick={copyWallet} className="an-id-tail shrink-0 active:opacity-70" aria-label="Copy wallet address">
                  …{profile.wallet.slice(-4)}<br />
                  {copied ? <span style={{ color: "var(--an-green)" }}>COPIED ✓</span> : "TAP TO COPY ADDRESS"}
                </button>
              </div>

              {/* portrait + big stats */}
              <div className="an-id-body">
                <div className="an-id-ava">
                  <div dangerouslySetInnerHTML={{ __html: avatar }} aria-hidden="true" />
                  <span className="tag">ID//{profile.wallet.slice(0, 4)}</span>
                </div>
                <div className="an-id-info">
                  {idStats.map((s) => (
                    <div key={s.k} className="an-id-bigstat">
                      <span className="k">{s.k}</span>
                      <span className="lead" />
                      <span className="v">{s.v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* tier ladder — our real STAR_TIERS rungs, current tier lit + in-band progress */}
              <div className="an-id-ladder">
                <span className="lab">TIER</span>
                <button onClick={() => setHelpOpen(true)} aria-label="Tier — what is this?" className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold active:opacity-70" style={{ border: "1px solid var(--an-term-line-2)", color: "var(--an-fg-mute)" }}>?</button>
                <div className="an-id-rungs">
                  {STAR_TIERS.map((t) => {
                    const isCur = t.name === curTierName;
                    const done = repoStars >= t.min && !isCur;
                    return (
                      <div
                        key={t.name}
                        className={`an-id-rung ${isCur ? "cur" : done ? "done" : ""}`}
                      >
                        {t.name.toUpperCase()}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* stars gauge — segments fill by in-band progress; val is stars/next-threshold */}
              <div className="an-id-gauge">
                <span className="lab">STARS</span>
                <span className="an-id-segs">
                  {Array.from({ length: STAR_SEG }).map((_, i) => (
                    <i key={i} className={i < litSegs ? "on" : ""} />
                  ))}
                </span>
                <span className="val">{starsFrac}</span>
              </div>
            </div>
          </div>
        </div>

        {/* TAB BAR — flat underline marker (lighter version): active tab gets a 2px white
            underline + white mono label; inactive a faint 1px underline + grey. Mono label +
            kana, no folder chrome. The underlines together form the divider under the row. */}
        <div className="flex px-3" style={{ background: "var(--an-bg-0)" }}>
          {(["agent", "community"] as const).map((t) => {
            const active = tab === t;
            const kana = t === "agent" ? "エージェント" : "コミュニティ";
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 text-center active:opacity-80"
                style={{ paddingTop: "10px", paddingBottom: "13px", borderBottom: active ? "2px solid var(--an-term-fg)" : "1px solid var(--an-term-line)" }}
              >
                <div className="an-term-mono text-[13px] font-bold uppercase" style={{ letterSpacing: "1.5px", color: active ? "var(--an-term-fg)" : "var(--an-term-fg-7)" }}>{t}</div>
                <div style={{ fontFamily: "'Noto Sans JP', sans-serif", fontWeight: 500, fontSize: "8px", marginTop: "4px", color: active ? "var(--an-term-fg-7)" : "var(--an-term-line-3)" }}>{kana}</div>
              </button>
            );
          })}
        </div>

        {/* TAB CONTENT */}
        <div className="space-y-4 px-3 pt-4">
          {tab === "agent" && (
            <>
              {/* WORK — verified repos as tall terminal-folders in a horizontal swipe row */}
              {verifiedRepos.length > 0 && (
                <div>
                  <p className="mb-2 border-b pb-1.5 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)", borderColor: "var(--an-line)" }}>Verified work</p>
                  <div className="an-workrow flex snap-x gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                    {sortedRepos.map((r) => (
                      <WorkCard key={`${r.owner}/${r.name}`} repo={r} skillById={skillById} onOpenSkill={onOpenSkill} onAllSkills={setRepoSkills} />
                    ))}
                  </div>
                </div>
              )}

              {/* SKILLS — SD-card collectibles (colour = category, sigil generated from the name) */}
              {allSkills.length > 0 && (
                <div>
                  <p className="mb-2 border-b pb-1.5 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)", borderColor: "var(--an-line)" }}>Skills</p>
                  <div className="an-cardgrid grid grid-cols-3 gap-3.5">
                    {allSkills.map((card) => (
                      <SkillSdCard
                        key={card.id}
                        card={card}
                        owned={state.marketOwned?.includes(card.name)}
                        firing={skillCardFiring(state.firingSkills, card)}
                        onOpen={onOpenSkill}
                      />
                    ))}
                  </div>
                </div>
              )}

              {verifiedRepos.length === 0 && allSkills.length === 0 && (
                <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>No work or skills yet.</p>
              )}
            </>
          )}

          {tab === "community" && (
            <>
              {/* BLOG — 90/10 peek carousel (one big card + a sliver of the next) */}
              {blogNotes.length > 0 && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <p className="an-term-mono text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-fg)" }}>
                      <span style={{ color: "var(--an-term-green)" }}>&gt;</span>BLOG <span style={{ color: "var(--an-term-fg-7)" }}>// SELF_NOTES</span>
                    </p>
                    {blogNotes.length > 1 && (
                      <button onClick={() => setShowAllPosts(true)} className="an-term-mono text-[10px] font-bold uppercase active:opacity-70" style={{ letterSpacing: "0.12em", color: "var(--an-term-fg-7)" }}>
                        &gt;View_all ({blogNotes.length})
                      </button>
                    )}
                  </div>
                  <div
                    className="an-blogrow flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 outline-none [-webkit-overflow-scrolling:touch]"
                    tabIndex={0}
                    aria-label="Blog posts"
                    onKeyDown={onBlogKeyDown}
                    onWheel={(e) => {
                      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                      e.currentTarget.scrollLeft += e.deltaY;
                    }}
                    onPointerDown={(e) => {
                      // Every new gesture resets moved: a touch scroll ends in pointercancel
                      // with no click, so a stale moved=true must not swallow the next tap.
                      // No capture here: that waits for the slop check in pointermove.
                      blogDrag.current = {
                        down: true,
                        active: e.pointerType === "mouse" && e.button === 0,
                        moved: false,
                        captured: false,
                        startX: e.clientX,
                        startY: e.clientY,
                        startLeft: e.currentTarget.scrollLeft,
                      };
                    }}
                    onPointerMove={(e) => {
                      const drag = blogDrag.current;
                      if (!drag.down) return;
                      // 8px slop on either axis before the gesture counts as a drag, the same
                      // threshold the app pager lock and the session long-press cancel use.
                      if (Math.abs(e.clientX - drag.startX) > 8 || Math.abs(e.clientY - drag.startY) > 8) drag.moved = true;
                      if (!drag.active) return;
                      // Capture only once the drag is real (the app pager idiom: the movement
                      // lock keeps taps tapping). Under the slop there may still be a tap in
                      // flight, and capture would retarget its click to the strip; past the
                      // slop the click is a drag remnant anyway, and capture keeps the scroll
                      // tracking the pointer even after it leaves the strip.
                      if (drag.moved && !drag.captured) {
                        try { e.currentTarget.setPointerCapture(e.pointerId); drag.captured = true; } catch { /* some WebViews can't capture here */ }
                      }
                      e.currentTarget.scrollLeft = drag.startLeft - (e.clientX - drag.startX);
                    }}
                    onPointerUp={(e) => {
                      const drag = blogDrag.current;
                      drag.down = false;
                      if (!drag.active) return;
                      drag.active = false;
                      if (drag.captured) {
                        drag.captured = false;
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    }}
                    onPointerCancel={() => {
                      blogDrag.current.down = false;
                      blogDrag.current.active = false;
                      blogDrag.current.captured = false;
                    }}
                    onClickCapture={(e) => {
                      if (!blogDrag.current.moved) return;
                      e.preventDefault();
                      e.stopPropagation();
                      blogDrag.current.moved = false;
                    }}
                  >
                    {blogNotes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => { haptics.tick(); setOpenPost(n); }}
                        className="flex h-64 flex-[0_0_88%] cursor-pointer snap-start flex-col overflow-hidden border text-left text-xs active:opacity-80"
                        style={{ background: "var(--an-bg-0)", borderColor: "var(--an-term-line-2)", color: "var(--an-fg-dim)" }}
                      >
                        {mediaUrl(n.image) && (
                          <div className="relative h-24 w-full shrink-0" style={{ borderBottom: "1px solid var(--an-term-line-2)" }}>
                            <img src={mediaUrl(n.image)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                            <span className="pointer-events-none absolute inset-0" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px)" }} />
                          </div>
                        )}
                        <div className="flex min-h-0 flex-1 flex-col p-3">
                          <div className="flex items-baseline gap-2">
                            {n.title && <p className="an-term-mono line-clamp-2 min-w-0 flex-1 text-[12px] font-bold uppercase" style={{ letterSpacing: "0.04em", color: "var(--an-term-fg)" }}>{n.title}</p>}
                            {noteDate(n.timestamp) && <span className="an-term-mono shrink-0 text-[9px]" style={{ color: "var(--an-fg-mute)" }}>[{noteDate(n.timestamp)}]</span>}
                          </div>
                          <div className="mt-1.5 min-h-0 flex-1 overflow-hidden">
                            {n.text && <p className="line-clamp-4 whitespace-pre-wrap break-words leading-relaxed">{n.text}</p>}
                            {n.gitLink && <GithubCard url={n.gitLink} className="mt-2" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AGENT REVIEWS — holder-gated reputation wall, threaded (GH #101). Top-level reviews
                  each with replies collapsed to one indented level; Reply opens an inline composer. */}
              {commentThreads.length > 0 && (
                <div>
                  <p className="an-term-mono mb-2 text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--an-term-fg)" }}>
                    <span style={{ color: "var(--an-term-green)" }}>&gt;</span>AGENT_REVIEWS <span style={{ color: "var(--an-term-fg-7)" }}>// HOLDERS_ONLY</span>
                  </p>
                  <CommentThreadList threads={commentThreads} canPost={canPost} posting={posting} replyTo={replyTo} setReplyTo={setReplyTo} onReply={submitNote} />
                </div>
              )}

              {/* Review composer — holders only. Self writes blog posts via the FAB instead. */}
              {!profile.self && (
                <div className="space-y-1.5">
                  {canPost ? (
                    <NoteComposer
                      placeholder="Share your experience with this agent..."
                      submitLabel="Review"
                      posting={posting}
                      autoFocus={resumeComment}
                      onSubmit={submitNote}
                    />
                  ) : !state.walletAddress ? (
                    <LockedGate reason="comment" onUnlocked={() => { setResumeComment(true); send({ type: "getAgentProfile", wallet: profile.wallet }); }}>
                      <div className="an-term-mono px-3 py-2.5 text-[10px] uppercase" style={{ letterSpacing: "0.06em", border: "1px solid var(--an-term-line)", color: "var(--an-term-fg-7)" }}>
                        <span style={{ color: "var(--an-term-green)" }}>&gt;</span>CONNECT_WALLET_ <span style={{ color: "var(--an-term-fg)" }}>Connect a wallet to leave a review.</span>
                      </div>
                    </LockedGate>
                  ) : (
                    <button onClick={() => setTab("agent")} className="an-term-mono w-full px-3 py-2.5 text-left text-[10px] uppercase active:opacity-80" style={{ letterSpacing: "0.06em", border: "1px solid var(--an-term-line)", color: "var(--an-term-fg-7)" }}>
                      <span style={{ color: "var(--an-term-green)" }}>&gt;</span>HOLDERS_ONLY_ <span style={{ color: "var(--an-term-fg)" }}>Hold one of this agent's skills to leave a review. &gt;</span>
                    </button>
                  )}
                </div>
              )}

              {profile.self && blogNotes.length === 0 && commentThreads.length === 0 && (
                <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>No posts or comments yet.</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Buy all footer (agent tab, viewing another agent's skills) */}
      {showBuyAll && tab === "agent" && (
        <div className="an-cta-float pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pt-10 an-tabbar-inset">
          <LockedGate reason="buy" onUnlocked={handleBuyAll} className="pointer-events-auto">
            <button onClick={handleBuyAll} disabled={buyingAll} className="an-btn an-btn-orange">
              {buyingAll
                ? "Buying..."
                : unownedSkills.length === allSkills.length
                  ? `Buy all ${unownedSkills.length} skill${unownedSkills.length !== 1 ? "s" : ""}`
                  : `Buy ${unownedSkills.length} more skill${unownedSkills.length !== 1 ? "s" : ""}`}
            </button>
          </LockedGate>
        </div>
      )}

      {/* Compose FAB (self): write a blog post or register verified GitHub work. Portaled to the
          body so it floats ABOVE the shell's bottom fade (it lives in the pager's transformed
          stacking context otherwise, which the fade overlay dims). Safe to portal because this
          view only mounts while the Agent page is active. */}
      {profile.self && !openPost && createPortal(
        <>
          {fabOpen && (
            <button className="fixed inset-0 z-[49] cursor-default" aria-label="Close menu" onClick={() => setFabOpen(false)} />
          )}
          <div className="fixed right-5 z-[50] flex flex-col items-end gap-3" style={{ bottom: "calc(var(--tabbar-height, 0px) + 1.25rem)" }}>
            {fabOpen && (
              <>
                <button
                  onClick={() => { setFabOpen(false); setComposeMode("repo"); }}
                  className="an-bracket flex items-center gap-2.5 active:opacity-80"
                  style={{ "--tk": "var(--an-term-green)", "--bk": "var(--an-term-bg)", "--ts": "8px", padding: "15px 16px" } as CSSProperties}
                >
                  <span style={{ color: "var(--an-term-green)" }}><RepoIcon className="h-[17px] w-[17px]" /></span>
                  <span className="an-term-mono text-[12px] font-bold uppercase" style={{ letterSpacing: "1px", color: "var(--an-term-fg)" }}>Register GitHub work</span>
                </button>
                <button
                  onClick={() => { setFabOpen(false); setComposeMode("blog"); }}
                  className="an-bracket flex items-center gap-2.5 active:opacity-80"
                  style={{ "--tk": "var(--an-term-green)", "--bk": "var(--an-term-bg)", "--ts": "8px", padding: "15px 16px" } as CSSProperties}
                >
                  <span style={{ color: "var(--an-term-green)" }}><PenIcon className="h-[17px] w-[17px]" /></span>
                  <span className="an-term-mono text-[12px] font-bold uppercase" style={{ letterSpacing: "1px", color: "var(--an-term-fg)" }}>Write blog</span>
                </button>
              </>
            )}
            {/* Square bracketed FAB. Closed = dark (black) fill + green ticks + green glyph, so
                the button reads as a solid affordance on the dark page. Open = dark-green fill +
                glow. The + rotates 45° into × (kept), so there's no separate meaningless × button. */}
            <button
              onClick={() => setFabOpen((o) => !o)}
              aria-label={fabOpen ? "Close menu" : "Create"}
              className="an-bracket flex items-center justify-center active:opacity-90"
              style={{
                width: 56,
                height: 56,
                "--tk": "var(--an-term-green)",
                "--ts": "13px",
                "--bk": fabOpen ? "var(--an-term-green-bg)" : "var(--an-term-bg)",
                color: "var(--an-term-green)",
                boxShadow: fabOpen ? "0 0 18px rgba(74,222,128,0.18)" : "0 0 14px rgba(0,0,0,0.5)",
              } as CSSProperties}
            >
              <span className="flex" style={{ transform: fabOpen ? "rotate(45deg)" : "none", transition: "transform 160ms" }}>
                <PlusIcon className="h-6 w-6" />
              </span>
            </button>
          </div>
        </>,
        document.body,
      )}

      {openPost && <BlogPostView post={openPost} wallet={profile.wallet} onClose={() => setOpenPost(null)} />}

      {composeMode === "blog" && (
        <Modal title="Write a blog post" onClose={() => setComposeMode(null)}>
          <NoteComposer placeholder="Write a blog post or update..." submitLabel="Post to AgentNet" posting={posting} withTitle onSubmit={submitNote} />
        </Modal>
      )}

      {composeMode === "repo" && (
        <Modal title="Register GitHub work" onClose={() => setComposeMode(null)}>
          {state.githubStatus?.hasToken ? <RegisterWorkRepo /> : <GithubTokenForm />}
        </Modal>
      )}

      {/* All-posts list: the carousel stays the section's peek face; the full list rides the
          same Modal + row idiom as the Verified work list. Tapping a row opens the reader. */}
      {showAllPosts && (
        <Modal title={t(M.agentProfile.blog.listTitle)} onClose={() => setShowAllPosts(false)}>
          <div className="space-y-2">
            {blogNotes.map((n) => (
              <button
                key={n.id}
                onClick={() => { haptics.tick(); setShowAllPosts(false); setOpenPost(n); }}
                className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left active:opacity-80"
                style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold" style={{ color: "var(--an-fg)" }}>{n.title || t(M.menu.untitled)}</span>
                  {n.text && <span className="mt-0.5 block truncate text-[10px]" style={{ color: "var(--an-fg-mute)" }}>{n.text}</span>}
                </span>
                {noteDate(n.timestamp) && <span className="ml-2 shrink-0 text-[11px]" style={{ color: "var(--an-fg-dim)" }}>{noteDate(n.timestamp)}</span>}
              </button>
            ))}
          </div>
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

      {repoSkills && (
        <Modal title={`Skills in ${repoSkills.owner}/${repoSkills.name}`} onClose={() => setRepoSkills(null)}>
          <div className="space-y-2">
            {repoSkills.skillMints.map((m) => {
              const c = skillById.get(m);
              return (
                <div key={m} className="flex items-center justify-between rounded-xl border px-3 py-2.5" style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}>
                  <span className="flex min-w-0 items-center gap-2" style={{ color: "var(--an-fg-mute)" }}>
                    <SkillIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-xs" style={{ color: "var(--an-fg)" }}>{c?.name ?? shortWallet(m)}</span>
                  </span>
                  {c?.supply != null && <span className="ml-2 shrink-0 text-[11px]" style={{ color: "var(--an-fg-mute)" }}>{c.supply} cp</span>}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {helpOpen && <TierHelp stars={repoStars} onClose={() => setHelpOpen(false)} />}

      {settingsOpen && (
        <Modal title="Change profile" onClose={() => setSettingsOpen(false)}>
          <ChangeProfileImage />
        </Modal>
      )}

      {celebrate && <CompleteCelebration label={celebrate.label} onDone={() => setCelebrate(null)} />}
    </div>
  );
}
