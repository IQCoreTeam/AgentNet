import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseGithubLink, safeExternalUrl } from "@iqlabs-official/agent-sdk/links/github.js";
import { useStore } from "../state/store";
import type { AgentProfile, SkillCard } from "../transport/protocol";
import { SkillIcon } from "../icons";

// VerifiedRepo isn't re-exported by the protocol barrel; derive it from AgentProfile.
type VRepo = NonNullable<AgentProfile["verifiedRepos"]>[number];
import { walletAvatarPalette, walletAvatarSvg, walletBandColor } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
import { PostCelebration } from "./PostCelebration";
import { SkillSdCard } from "./SkillSdCard";
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

// Per-repo rarity ramp for the WORK cards: a repo's own star count gives it a neon edge,
// escalating in steps (collection-desire). Starts at 3 stars; below that it's "common"
// (plain line border). Tight, not glowing — a crisp colored edge + a faint inset ring.
const REPO_RARITY = [
  { min: 250, color: "#f472b6" }, // legendary - pink
  { min: 50, color: "#ffcb45" },  // gold
  { min: 10, color: "#a78bfa" },  // violet
  { min: 3, color: "#3fb9e0" },   // uncommon - cyan
] as const;

function repoRarity(stars: number) {
  return REPO_RARITY.find((t) => stars >= t.min) ?? null;
}

// The agent's "IQ tier" badge for the hero (Top Bar / Agent design): a sharp tier-toned terminal
// box — star + TIER name + a segmented charge bar (lit segments glow the tier colour) + the raw
// "stars/next-threshold" fraction. The whole box is tappable to open the tier explanation (the
// old "?" is dropped per the design; the box itself is the affordance). Tier colour generalises
// the design's bronze to silver/gold/legendary via the shared --an-tier-* tokens.
function TierGauge({ stars, onHelp }: { stars: number; ink: string; onHelp: () => void }) {
  const { cur, next } = tierInfo(stars);
  const prevMin = cur?.min ?? 0;
  const label = (cur?.name ?? next?.name ?? STAR_TIERS[0].name).toUpperCase();
  const color = cur?.color ?? next?.color ?? STAR_TIERS[0].color;
  const frac = next ? `${stars}/${next.min}` : "MAX";
  const pct = next ? Math.min(100, Math.max(0, ((stars - prevMin) / (next.min - prevMin)) * 100)) : 100;
  const SEG = 10;
  const filled = Math.round((pct / 100) * SEG);
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {/* tier name + fraction, stacked & right-aligned */}
      <div className="flex flex-col items-end gap-[3px] leading-none">
        <span className="an-term-mono text-[7px] font-bold" style={{ color, letterSpacing: "1.5px" }}>{label}</span>
        <span className="an-term-mono text-[10px] font-bold" style={{ color, letterSpacing: "0.5px" }}>[{frac}]</span>
      </div>
      {/* chunky segment charge bar — solid tier fill, dark empties, in a thin box */}
      <span className="flex gap-[2px]" style={{ border: "1px solid #3a3a3d", background: "#0a0a0b", padding: "3px" }}>
        {Array.from({ length: SEG }).map((_, i) => (
          <span key={i} style={{ width: "7px", height: "18px", background: i < filled ? color : "#23232a" }} />
        ))}
      </span>
      {/* round "?" help, kept as the discoverability affordance */}
      <button
        onClick={onHelp}
        aria-label="Tier — what is this?"
        className="an-term-mono flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold active:opacity-80"
        style={{ width: "22px", height: "22px", border: "1px solid #2e2e31", color: "#6a6a6a" }}
      >
        ?
      </button>
    </div>
  );
}

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
// the WORK cards and the blog/comment bodies. `className` controls outer spacing.
function GithubCard({ url, className = "mt-2" }: { url: string; className?: string }) {
  const info = parseGithubLink(url);
  if (!info) {
    const safe = safeExternalUrl(url);
    return safe ? (
      <a href={safe} target="_blank" rel="noreferrer" className={`block truncate text-[10px] text-blue-400 ${className}`}>{safe}</a>
    ) : null;
  }
  const kind = info.kind === "pull" ? "PR" : info.kind === "blob" ? "File" : info.kind === "commit" ? "Commit" : "Repo";
  return (
    <a
      href={info.href}
      target="_blank"
      rel="noreferrer"
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

// One WORK card: a refined "banner folder" — a flat tier-colour banner up top (with the GitHub
// octocat + a VERIFIED label and the folder-tab notch cut into it), a dark body with the bold
// repo name, a muted skill pill (tap opens the skill; "+N" opens the full list), and the star
// count. The banner colour is the repo's star tier (cyan/violet/gold/pink, green when untiered).
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
  const rarity = repoRarity(repo.stars);
  const theme = rarity?.color ?? "#3ac07a";
  function openRepo() {
    const u = safeExternalUrl(repo.url);
    if (u) window.open(u, "_blank", "noopener");
  }
  return (
    <div className="an-bfolder shrink-0 snap-start font-mono" style={{ "--theme": theme } as CSSProperties}>
      <div className="an-bfolder-banner" aria-hidden="true" />
      <span className="an-bfolder-tier">VERIFIED</span>
      <button onClick={openRepo} aria-label="Open repository" className="an-bfolder-cat active:opacity-70">
        <GithubMark className="h-5 w-5" style={{ color: "#0c0d10", opacity: 0.85 }} />
      </button>
      <span className="an-bfolder-tab" aria-hidden="true" />
      <div className="an-bfolder-body">
        <p className="an-bfolder-title">{repo.owner}/{repo.name}</p>
      </div>
      {rep && (
        <button
          onClick={() => (extra > 0 ? onAllSkills(repo) : onOpenSkill(rep))}
          className="an-bfolder-skill active:opacity-80"
        >
          <span className="an-bfolder-skill-i">✦</span>
          <span className="an-bfolder-skill-t">{rep.name}{extra > 0 ? ` +${extra}` : ""}</span>
        </button>
      )}
      <div className="an-bfolder-stars">
        <span className="an-bfolder-stars-n">{repo.stars}</span>
        <span className="an-bfolder-stars-s">★</span>
      </div>
    </div>
  );
}

interface NoteFields {
  text: string;
  title?: string;
  gitLink?: string;
  image?: string;
}

// One reusable note editor for both the blog modal (self, withTitle) and the inline comment
// box (holders). Keeps its own draft; the parent owns postAgentNote + success. Empty posts
// are blocked (need a title OR body); a title-only post is allowed. Image accepts an https
// link or an on-chain ref (resolved via the gateway on render).
function NoteComposer({
  placeholder,
  submitLabel,
  posting,
  disabled,
  withTitle,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  posting?: boolean;
  disabled?: boolean;
  withTitle?: boolean;
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
      <textarea className="an-term-field resize-none leading-relaxed" rows={5} placeholder={placeholder} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      <input className="an-term-field" placeholder="Image link / on-chain address / tx id (optional)" value={image} disabled={busy} onChange={(e) => setImage(e.target.value)} />
      {!imageOk && <p className="text-xs" style={{ color: "var(--an-red, #f87171)" }}>Image must be an https link, on-chain address, or tx id.</p>}
      {img && imageOk && mediaUrl(img) && <img src={mediaUrl(img)} alt="" referrerPolicy="no-referrer" className="h-20 w-20 rounded-lg object-cover" style={{ border: "1px solid var(--an-line)" }} />}
      <input className="an-term-field" placeholder="GitHub link (optional)" value={link} disabled={busy} onChange={(e) => setLink(e.target.value)} />
      <button onClick={submit} disabled={!hasContent || !imageOk || busy} className="an-btn an-btn-green">
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
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3.5" style={{ borderColor: "#1d1d20" }}>
          <h2 className="an-term-title text-[14px]" style={{ letterSpacing: "1px" }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-1 p-1.5 active:opacity-70" style={{ color: "#9a9a9a" }}>
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
        <p className="text-[11px]" style={{ color: "var(--an-red, #f87171)" }}>Only an https link, on-chain address, or tx id is allowed.</p>
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

interface Props {
  profile: AgentProfile;
  onBack: () => void;
  onOpenSkill: (card: SkillCard) => void;
}

export function AgentProfileView({ profile, onBack, onOpenSkill }: Props) {
  const { state, send } = useStore();
  const [tab, setTab] = useState<"agent" | "community">("agent");
  const [buyingAll, setBuyingAll] = useState(false);
  const blogDrag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [copied, setCopied] = useState(false);
  const avatar = useMemo(() => walletAvatarSvg(profile.wallet), [profile.wallet]);
  const avatarPalette = useMemo(() => walletAvatarPalette(profile.wallet), [profile.wallet]);
  const bandColor = useMemo(() => walletBandColor(profile.wallet), [profile.wallet]);
  // Mii-Maker form, kept dark: a clean rounded "booth" the avatar stands on, with the pfp
  // palette used only as a soft accent (not a bright tint, since the whole app is dark).
  // Static — no looping animation, to keep it light on the device.
  const bandInk = "var(--an-fg)";
  const heroAccent = avatarPalette.clothes ?? bandColor;
  const heroSecondary = avatarPalette.face_acc ?? bandColor;
  const heroLine = avatarPalette.line ?? bandColor;
  const [fabOpen, setFabOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<null | "blog" | "repo">(null);
  const [posting, setPosting] = useState(false);
  const [celebrate, setCelebrate] = useState<{ label: string } | null>(null);
  const [showAllRepos, setShowAllRepos] = useState(false);
  const [repoSkills, setRepoSkills] = useState<VRepo | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  function submitNote(f: NoteFields) {
    const text = f.text.trim();
    const title = f.title?.trim() || undefined;
    if ((!text && !title) || (!profile.self && !profile.canComment)) return; // no empty posts
    awaitingPost.current = true;
    setPosting(true);
    send({ type: "postAgentNote", agentWallet: profile.wallet, text, gitLink: f.gitLink, title, image: f.image });
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

  const allSkills = useMemo(() => [...(profile.createdSkills ?? [])], [profile.createdSkills]);
  const skillById = useMemo(() => new Map(allSkills.map((c) => [c.id, c])), [allSkills]);
  const verifiedRepos = profile.verifiedRepos ?? [];
  const repoStars = verifiedRepos.reduce((sum, r) => sum + (r.stars ?? 0), 0);
  const sortedRepos = [...verifiedRepos].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  const showBuyAll = !profile.self && allSkills.length > 0;
  const blogNotes = (profile.notes ?? []).filter((n) => n.isSelfNote);
  const comments = (profile.notes ?? []).filter((n) => !n.isSelfNote);
  const canPost = profile.self || profile.canComment;

  const stats = [
    { n: profile.createdSkills?.length ?? 0, label: "Created", hero: false },
    { n: profile.ownedSkills?.length ?? 0, label: "Owned", hero: false },
    { n: profile.reputation?.totalSupply ?? 0, label: "Copies", hero: true },
  ];

  function noteDate(timestamp?: number) {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "";
    }
  }

  function onBlogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.currentTarget.scrollBy({ left: e.key === "ArrowRight" ? 280 : -280, behavior: "smooth" });
  }

  return (
    <div className="relative flex h-full flex-col" style={{ background: "var(--an-bg-0)" }}>
      <div
        className="flex-1 overflow-y-auto an-tabbar-inset"
        style={showBuyAll && tab === "agent" ? { paddingBottom: "calc(var(--tabbar-height, 0px) + max(0.75rem, env(safe-area-inset-bottom)) + 76px)" } : undefined}
      >
        {/* HERO STAGE — Mii-Maker booth kept dark: a clean rounded stage the avatar stands on,
            with the pfp palette as a soft accent only. Static (no looping motion). */}
        <div
          className="an-agent-hero sticky top-0 z-20 relative overflow-hidden px-3 pb-4 pt-3"
          style={{
            "--agent-accent": heroAccent,
            "--agent-secondary": heroSecondary,
            "--agent-line": heroLine,
          } as CSSProperties}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{
              background: `radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, ${heroAccent} 16%, transparent), transparent 62%)`,
            }}
            aria-hidden="true"
          />

          <div className="relative z-10">
            {/* top controls: back + address + settings (left), IQ tier gauge (right) */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <button
                  onClick={onBack}
                  aria-label="Back"
                  className="an-bracket flex shrink-0 items-center justify-center"
                  style={{ width: "38px", height: "38px", border: "1px solid #1f1f23", color: "#cfcfcf", "--ts": "8px", "--bk": "#0d0d0e", "--tk": "#6e6e72" } as CSSProperties}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 6l-6 6 6 6" /></svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button onClick={copyWallet} className="an-term-title shrink-0 text-[16px] leading-none">{profile.wallet.slice(0, 6)}</button>
                    {copied && <span className="text-[10px] shrink-0" style={{ color: "var(--an-green)" }}>✓</span>}
                    {profile.self && (
                      <span className="an-term-mono shrink-0 text-[8px] font-bold uppercase tracking-wider" style={{ color: "#f2f2f2", border: "1px solid #3a3a3d", padding: "2px 6px" }}>YOU</span>
                    )}
                    {profile.self && (
                      <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="shrink-0" style={{ color: "#8a8a8a" }}><GearIcon className="h-4 w-4" /></button>
                    )}
                  </div>
                  <div className="an-term-mono truncate leading-none" style={{ fontSize: "9px", letterSpacing: "1px", color: "#6a6a6a", marginTop: "3px" }}>
                    …{profile.wallet.slice(-4)}_AGENT <span style={{ color: "#3a3a3a" }}>/</span> <span style={{ fontFamily: "'Noto Sans JP', sans-serif", color: "#5a5a5d" }}>エージェント</span>
                  </div>
                </div>
              </div>
              <TierGauge stars={repoStars} ink={bandInk} onHelp={() => setHelpOpen(true)} />
            </div>

            {/* big avatar — Mii booth: the character stands on a clean rounded stage with a
                soft ground shadow. Static, no motion. */}
            <div className="mt-2 flex justify-center">
              <div className="an-agent-avatar-stage" aria-hidden="true">
                <span className="an-agent-ground" />
                <div className="an-agent-avatar" dangerouslySetInnerHTML={{ __html: avatar }} />
              </div>
            </div>

            {/* HUD stat cards — compact glass, tied to the portrait accent instead of a broad tint */}
            <div className="relative z-10 -mt-6 grid grid-cols-3 gap-2">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className={`an-agent-stat rounded-[3px] p-3 text-center ${s.hero ? "is-hero" : ""}`}
                >
                  <p className={`font-bold ${s.hero ? "text-2xl" : "text-xl"}`} style={{ color: bandInk }}>{s.n}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--an-fg-dim)" }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* TAB BAR — file-folder tabs: the active tab is the open folder front (same color as
            the content, raised, bordered, and it breaks the shelf line = folder mouth); the
            inactive tab is a darker tab tucked lower and behind the shelf. No colored accent —
            the folder shape carries it. */}
        <div className="flex items-end gap-1.5 px-3" style={{ background: "var(--an-bg-0)" }}>
          {(["agent", "community"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-t-[3px] text-sm font-bold capitalize ${active ? "-mb-px pb-2.5 pt-3" : "pb-2 pt-2 opacity-80"}`}
                style={
                  active
                    ? {
                        background: "var(--an-bg-0)",
                        borderTop: "1px solid var(--an-line)",
                        borderLeft: "1px solid var(--an-line)",
                        borderRight: "1px solid var(--an-line)",
                        borderBottom: "1px solid var(--an-bg-0)",
                        color: "var(--an-fg)",
                      }
                    : {
                        background: "color-mix(in srgb, #000 28%, var(--an-bg-0))",
                        borderTop: "1px solid color-mix(in srgb, var(--an-line) 60%, transparent)",
                        borderLeft: "1px solid color-mix(in srgb, var(--an-line) 60%, transparent)",
                        borderRight: "1px solid color-mix(in srgb, var(--an-line) 60%, transparent)",
                        color: "var(--an-fg-dim)",
                      }
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* TAB CONTENT — the shelf line under the tabs forms the folder body's top edge */}
        <div className="space-y-4 px-3 pt-4" style={{ borderTop: "1px solid var(--an-line)" }}>
          {tab === "agent" && (
            <>
              {/* WORK — verified repos as tall terminal-folders in a horizontal swipe row */}
              {verifiedRepos.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Work</p>
                  <div className="flex snap-x gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                    {sortedRepos.map((r) => (
                      <WorkCard key={`${r.owner}/${r.name}`} repo={r} skillById={skillById} onOpenSkill={onOpenSkill} onAllSkills={setRepoSkills} />
                    ))}
                  </div>
                </div>
              )}

              {/* SKILLS — SD-card collectibles (colour = category, sigil generated from the name) */}
              {allSkills.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Skills</p>
                  <div className="grid grid-cols-3 gap-3.5">
                    {allSkills.map((card) => (
                      <SkillSdCard
                        key={card.id}
                        card={card}
                        owned={state.marketOwned?.includes(card.name)}
                        firing={state.firingSkills?.some((f) => f.name === card.name)}
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
                  <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Blog</p>
                  <div
                    className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 outline-none [-webkit-overflow-scrolling:touch]"
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
                      <article
                        key={n.id}
                        className="flex h-64 flex-[0_0_88%] snap-start flex-col rounded-xl border p-3.5 text-xs"
                        style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)", color: "var(--an-fg-dim)" }}
                      >
                        {mediaUrl(n.image) && <img src={mediaUrl(n.image)} alt="" referrerPolicy="no-referrer" className="mb-2 h-28 w-full shrink-0 rounded-lg object-cover" />}
                        {n.title && <p className="mb-1 line-clamp-1 shrink-0 text-sm font-bold" style={{ color: "var(--an-fg)" }}>{n.title}</p>}
                        <div className="min-h-0 flex-1 overflow-hidden">
                          {n.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{n.text}</p>}
                          {n.gitLink && <GithubCard url={n.gitLink} className="mt-2" />}
                        </div>
                        {noteDate(n.timestamp) && <p className="mt-2 shrink-0 text-[10px]" style={{ color: "var(--an-fg-mute)" }}>{noteDate(n.timestamp)}</p>}
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {/* COMMENTS — flat stack (replies deferred). Each: commenter avatar + wallet + date + body */}
              {comments.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Comments</p>
                  <div className="space-y-2">
                    {comments.map((n) => (
                      <div key={n.id} className="rounded-xl border p-3.5 text-sm" style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)", color: "var(--an-fg-dim)" }}>
                        <div className="mb-2 flex items-center gap-2.5">
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(n.author) }} />
                          <span className="font-mono text-xs" style={{ color: "var(--an-fg-dim)" }}>{shortWallet(n.author)}</span>
                          {noteDate(n.timestamp) && <span className="ml-auto text-[11px]" style={{ color: "var(--an-fg-mute)" }}>{noteDate(n.timestamp)}</span>}
                        </div>
                        {mediaUrl(n.image) && <img src={mediaUrl(n.image)} alt="" referrerPolicy="no-referrer" className="mb-2 max-h-32 w-full rounded-lg object-cover" />}
                        {n.title && <p className="mb-0.5 text-sm font-bold" style={{ color: "var(--an-fg)" }}>{n.title}</p>}
                        {n.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{n.text}</p>}
                        {n.gitLink && <GithubCard url={n.gitLink} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comment composer — holders only. Self writes blog posts via the FAB instead. */}
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
                    <p className="rounded-xl px-2.5 py-2 text-[11px]" style={{ background: "var(--an-bg-1)", border: "1px solid var(--an-line)", color: "var(--an-fg-mute)" }}>
                      Hold a skill to comment.
                    </p>
                  )}
                </div>
              )}

              {profile.self && blogNotes.length === 0 && comments.length === 0 && (
                <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>No posts or comments yet.</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Buy all footer (agent tab, viewing another agent's skills) */}
      {showBuyAll && tab === "agent" && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pt-10 an-tabbar-inset"
          style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--an-bg-0) 60%, transparent), transparent)" }}
        >
          <button onClick={handleBuyAll} disabled={buyingAll} className="an-btn an-btn-orange pointer-events-auto">
            {buyingAll ? "Buying..." : `Buy all ${allSkills.length} skill${allSkills.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* Compose FAB (self): write a blog post or register verified GitHub work */}
      {profile.self && (
        <>
          {fabOpen && (
            <button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setFabOpen(false)} />
          )}
          <div className="absolute right-5 z-40 flex flex-col items-end gap-3" style={{ bottom: "calc(var(--tabbar-height, 0px) + 1.25rem)" }}>
            {fabOpen && (
              <>
                <button
                  onClick={() => { setFabOpen(false); setComposeMode("repo"); }}
                  className="flex items-center gap-3 rounded-full pl-5 pr-6 text-sm font-semibold shadow-lg"
                  style={{ minHeight: 52, background: "var(--an-bg-1)", border: "1.5px solid var(--an-green-line)", color: "var(--an-fg)" }}
                >
                  <span style={{ color: "var(--an-green-line)" }}><RepoIcon className="h-5 w-5" /></span> Register GitHub work
                </button>
                <button
                  onClick={() => { setFabOpen(false); setComposeMode("blog"); }}
                  className="flex items-center gap-3 rounded-full pl-5 pr-6 text-sm font-semibold shadow-lg"
                  style={{ minHeight: 52, background: "var(--an-bg-1)", border: "1.5px solid var(--an-green-line)", color: "var(--an-fg)" }}
                >
                  <span style={{ color: "var(--an-green-line)" }}><PenIcon className="h-5 w-5" /></span> Write blog
                </button>
              </>
            )}
            <button
              onClick={() => setFabOpen((o) => !o)}
              aria-label="Create"
              className="flex h-16 w-16 items-center justify-center rounded-full shadow-xl"
              style={{ background: "var(--an-bg-1)", border: "2px solid var(--an-green)", color: "var(--an-green)", transform: fabOpen ? "rotate(45deg)" : "none", transition: "transform 150ms" }}
            >
              <PlusIcon className="h-7 w-7" />
            </button>
          </div>
        </>
      )}

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

      {celebrate && <PostCelebration label={celebrate.label} onDone={() => setCelebrate(null)} />}
    </div>
  );
}
