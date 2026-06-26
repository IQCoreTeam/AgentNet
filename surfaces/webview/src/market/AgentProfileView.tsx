import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseGithubLink, safeExternalUrl } from "@iqlabs-official/agent-sdk/links/github.js";
import { useStore } from "../state/store";
import type { AgentProfile, SkillCard } from "../transport/protocol";
import { SkillIcon, CollectionIcon } from "../icons";

// VerifiedRepo isn't re-exported by the protocol barrel; derive it from AgentProfile.
type VRepo = NonNullable<AgentProfile["verifiedRepos"]>[number];
import { walletAvatarSvg, walletBandColor } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
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
const STAR_TIERS = [
  { name: "Bronze", min: 10, color: "#cd7f32" },
  { name: "Silver", min: 50, color: "#c0c0c0" },
  { name: "Gold", min: 250, color: "#ffd700" },
  { name: "Legendary", min: 1000, color: "#c084fc" },
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

// The agent's "IQ tier" badge for the hero: star glyph + tier name + a 5-segment gauge +
// the raw "stars/next-threshold" fraction (e.g. 9/10 = on the way to Bronze) + a "?" that
// opens the tier explanation. Always shown so the system is discoverable from zero.
function TierGauge({ stars, ink, onHelp }: { stars: number; ink: string; onHelp: () => void }) {
  const { cur, next } = tierInfo(stars);
  const prevMin = cur?.min ?? 0;
  const label = cur?.name ?? next?.name ?? STAR_TIERS[0].name;
  const color = cur?.color ?? next?.color ?? STAR_TIERS[0].color;
  const frac = next ? `${stars}/${next.min}` : "max";
  const pct = next ? Math.min(100, Math.max(0, Math.round(((stars - prevMin) / (next.min - prevMin)) * 100))) : 100;
  const inkBorder = `color-mix(in srgb, ${ink} 55%, transparent)`;
  const inkFaint = `color-mix(in srgb, ${ink} 28%, transparent)`;
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ border: `1px solid ${inkBorder}` }}>
      <span className="inline-flex items-center" style={{ color }}><StarIcon className="h-3.5 w-3.5" /></span>
      <span className="text-[11px] font-bold" style={{ color: ink }}>{label}</span>
      {/* segmented slanted gauge (/ / / / /) — fills proportionally, so a partial tier shows a
          partly-filled segment (e.g. 9/10 = 4.5 of 5 lit) for the "charging up" game vibe. */}
      <span className="flex items-center gap-[2px]">
        {Array.from({ length: 5 }).map((_, i) => {
          const segFill = Math.min(1, Math.max(0, (pct / 100) * 5 - i)); // 0..1 within this segment
          return (
            <span key={i} className="relative h-2.5 w-2.5 overflow-hidden rounded-[1px]" style={{ background: inkFaint, transform: "skewX(-14deg)" }}>
              <span className="absolute inset-y-0 left-0" style={{ width: `${segFill * 100}%`, background: color }} />
            </span>
          );
        })}
      </span>
      <span className="text-[11px] font-semibold" style={{ color: ink }}>{frac}</span>
      <button
        onClick={onHelp}
        aria-label="What is this?"
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none"
        style={{ border: `1px solid ${inkBorder}`, color: ink }}
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

function priceLabel(price?: string) {
  if (!price || price === "0") return "free";
  return `${(Number(price) / 1e9).toFixed(3)} SOL`;
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
      className={`block rounded-md border px-2.5 py-2 active:opacity-80 ${className}`}
      style={{ background: "var(--an-bg-2)", borderColor: "var(--an-line)" }}
    >
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-blue-300">{kind}</span>
      <span className="mt-0.5 block truncate text-[11px] font-medium" style={{ color: "var(--an-fg)" }}>{info.label}</span>
      <span className="mt-0.5 block truncate text-[10px]" style={{ color: "var(--an-fg-mute)" }}>{info.meta}</span>
    </a>
  );
}

// One horizontal WORK card: a verified repo with its star count, a GitHub embed of the repo,
// and the skills linked to it. "+N more" opens the full skill list.
function WorkCard({
  repo,
  skillById,
  onAllSkills,
}: {
  repo: VRepo;
  skillById: Map<string, SkillCard>;
  onAllSkills: (repo: VRepo) => void;
}) {
  const linked = repo.skillMints
    .map((m) => skillById.get(m))
    .filter((c): c is SkillCard => !!c)
    .sort((a, b) => (b.supply ?? 0) - (a.supply ?? 0));
  return (
    <div
      className="flex min-w-[260px] max-w-[300px] flex-[0_0_84%] snap-start flex-col gap-3 rounded-xl border p-4 sm:flex-[0_0_280px]"
      style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center" style={{ color: "#f5b94a" }}><StarIcon className="h-5 w-5" /></span>
        <span className="text-2xl font-bold leading-none" style={{ color: "var(--an-fg)" }}>{repo.stars}</span>
        <span className="text-xs" style={{ color: "var(--an-fg-mute)" }}>stars</span>
        {repo.forks > 0 && <span className="ml-auto text-xs" style={{ color: "var(--an-fg-mute)" }}>⑂ {repo.forks}</span>}
      </div>
      <GithubCard url={repo.url} className="" />
      {linked.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {linked.slice(0, 3).map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]" style={{ background: "var(--an-bg-2)", color: "var(--an-fg-dim)" }}>
              <SkillIcon className="h-3 w-3 shrink-0" />
              <span className="max-w-[100px] truncate" style={{ color: "var(--an-fg)" }}>{c.name}</span>
              {c.supply != null && <span style={{ color: "var(--an-fg-mute)" }}>{c.supply}</span>}
            </span>
          ))}
          {linked.length > 3 && (
            <button onClick={() => onAllSkills(repo)} className="rounded-md px-2 py-1 text-[11px] font-medium" style={{ color: "var(--an-green)" }}>
              +{linked.length - 3} more
            </button>
          )}
        </div>
      ) : (
        <span className="text-[11px]" style={{ color: "var(--an-fg-mute)" }}>
          {repo.skillMints.length} skill{repo.skillMints.length !== 1 ? "s" : ""} linked
        </span>
      )}
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
  const inputStyle = { background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg)" } as const;
  function submit() {
    if (!hasContent || !imageOk || busy) return;
    onSubmit({ text: text.trim(), title: title.trim() || undefined, gitLink: link.trim() || undefined, image: img || undefined });
    setTitle(""); setText(""); setLink(""); setImage("");
  }
  return (
    <div className="space-y-2">
      {withTitle && (
        <input className="w-full rounded-xl px-2.5 py-2 text-sm font-semibold focus:outline-none" style={inputStyle} placeholder="Title (optional)" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      )}
      <textarea className="w-full resize-none rounded-xl p-2.5 text-sm focus:outline-none" style={inputStyle} rows={3} placeholder={placeholder} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      <input className="w-full rounded-xl px-2.5 py-2 text-sm focus:outline-none" style={{ ...inputStyle, color: "var(--an-fg-dim)" }} placeholder="Image link / on-chain address / tx id (optional)" value={image} disabled={busy} onChange={(e) => setImage(e.target.value)} />
      {!imageOk && <p className="text-[11px]" style={{ color: "var(--an-red, #f87171)" }}>Image must be an https link, on-chain address, or tx id.</p>}
      {img && imageOk && mediaUrl(img) && <img src={mediaUrl(img)} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-lg object-cover" style={{ border: "1px solid var(--an-line)" }} />}
      <input className="w-full rounded-xl px-2.5 py-2 text-sm focus:outline-none" style={{ ...inputStyle, color: "var(--an-fg-dim)" }} placeholder="GitHub link (optional)" value={link} disabled={busy} onChange={(e) => setLink(e.target.value)} />
      <button onClick={submit} disabled={!hasContent || !imageOk || busy} className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40" style={{ background: "var(--an-green)", color: "var(--an-on-green)" }}>
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
  const bandColor = useMemo(() => walletBandColor(profile.wallet), [profile.wallet]);
  // The hero is now a DEEP MUTED tint of the avatar color over the dark base (not the raw
  // neon color), so it reads as a dark surface whatever the hue — meaning ink is always
  // near-white. `band`/`bandSoft` are the tint at the top/bottom of the hero so it melts into
  // the tab strip + theme instead of a flat saturated slab.
  const bandInk = "#f5f5f5";
  const band = `color-mix(in srgb, ${bandColor} 42%, var(--an-bg-0))`;
  const bandSoft = `color-mix(in srgb, ${bandColor} 16%, var(--an-bg-0))`;
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
  const skillsOneCol = allSkills.length <= 10; // ≤10: chunky single-column rows (mobile feel); >10: 2-col grid

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
      <div className={`flex-1 overflow-y-auto ${showBuyAll && tab === "agent" ? "" : "an-tabbar-inset"}`}>
        {/* HERO BAND — a DEEP MUTED tint of the avatar color (not the raw neon), gradient-
            fading down into the dark theme so it reads as a rich surface, not a flat slab.
            Light controls/stats stay legible since the tint is always dark. Shared by tabs. */}
        <div
          className="relative px-3 pb-3 pt-3"
          style={{
            background: `linear-gradient(180deg, ${band} 0%, ${bandSoft} 100%)`,
          }}
        >
          {/* top controls: back + address + settings (left), IQ tier gauge (right) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <button onClick={onBack} aria-label="Back" className="shrink-0 text-lg leading-none text-white/90">←</button>
              <button onClick={copyWallet} className="flex min-w-0 items-center gap-1 font-mono text-sm text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                <span className="truncate">{shortWallet(profile.wallet)}</span>
                {copied ? <span className="text-[10px]">✓</span> : <CopyIcon className="h-3 w-3 shrink-0 opacity-70" />}
              </button>
              {profile.self && (
                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ border: `1px solid color-mix(in srgb, ${bandInk} 55%, transparent)`, color: bandInk }}>you</span>
              )}
              {profile.self && (
                <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="shrink-0 text-white/85"><GearIcon className="h-4 w-4" /></button>
              )}
            </div>
            <TierGauge stars={repoStars} ink={bandInk} onHelp={() => setHelpOpen(true)} />
          </div>

          {/* big avatar — sits on its own color, no separate background box */}
          <div className="mt-1 flex justify-center">
            <div className="overflow-hidden" style={{ width: 148, height: 148 }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: avatar }} />
          </div>

          {/* glass stat cards — translucent, overlapping the avatar's lower edge */}
          <div className="relative z-10 -mt-7 grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-3 text-center"
                style={{
                  background: s.hero ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                  border: `1px solid color-mix(in srgb, ${bandInk} 55%, transparent)`,
                  backdropFilter: "blur(4px)",
                  WebkitBackdropFilter: "blur(4px)",
                }}
              >
                <p className={`font-bold ${s.hero ? "text-2xl" : "text-xl"}`} style={{ color: bandInk }}>{s.n}</p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: bandInk }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* TAB BAR — vscode-style file tabs (skewed); the active tab lifts + gets a green
            top accent, the inactive one sits dimmer behind it. */}
        <div className="flex gap-2 px-3 pt-1.5" style={{ background: bandSoft }}>
          {(["agent", "community"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-t-lg py-2.5 text-sm font-bold capitalize ${active ? "-mb-px" : ""}`}
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
                    : { background: "rgba(0,0,0,0.22)", color: "rgba(255,255,255,0.85)" }
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* TAB CONTENT */}
        <div className="space-y-4 px-3 pt-4">
          {tab === "agent" && (
            <>
              {/* WORK — verified repos, horizontal, each with stars + a representative skill */}
              {verifiedRepos.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Work</p>
                    {sortedRepos.length > 3 && (
                      <button onClick={() => setShowAllRepos(true)} className="text-[11px] font-medium" style={{ color: "var(--an-fg-dim)" }}>
                        show more ▸
                      </button>
                    )}
                  </div>
                  <div className="flex snap-x gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                    {sortedRepos.map((r) => (
                      <WorkCard key={`${r.owner}/${r.name}`} repo={r} skillById={skillById} onAllSkills={setRepoSkills} />
                    ))}
                  </div>
                </div>
              )}

              {/* SKILLS — cover-dominant 2-col grid; workflows get the gold frame */}
              {allSkills.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Skills</p>
                  <div className={skillsOneCol ? "grid grid-cols-1 gap-2.5" : "grid grid-cols-2 gap-2"}>
                    {allSkills.map((card) => {
                      const isWorkflow = card.type === "workflow";
                      const reqCount = card.requiredSkills?.length ?? 0;
                      const cover = mediaUrl(card.image);
                      return (
                        <button
                          key={card.id}
                          onClick={() => onOpenSkill(card)}
                          className={`flex items-center rounded-xl border text-left active:scale-[0.98] ${skillsOneCol ? "gap-3 p-3.5" : "gap-2 p-2.5"}`}
                          style={{
                            background: isWorkflow ? "linear-gradient(160deg, rgba(245,158,11,0.16), var(--an-bg-1))" : "var(--an-bg-1)",
                            borderColor: isWorkflow ? "rgba(245,158,11,0.5)" : "var(--an-line)",
                          }}
                        >
                          <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg ${skillsOneCol ? "h-12 w-12" : "h-9 w-9"}`} style={{ background: "var(--an-bg-2)", color: isWorkflow ? "#f5b94a" : "var(--an-fg-mute)" }}>
                            {cover ? (
                              <img src={cover} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                            ) : isWorkflow ? (
                              <CollectionIcon className={skillsOneCol ? "h-6 w-6" : "h-5 w-5"} />
                            ) : (
                              <SkillIcon className={skillsOneCol ? "h-6 w-6" : "h-5 w-5"} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {isWorkflow && (
                                <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: "rgba(245,158,11,0.85)", color: "#1a1206" }}>WF·{reqCount}</span>
                              )}
                              <span className={`truncate font-semibold ${skillsOneCol ? "text-[15px]" : "text-xs"}`} style={{ color: "var(--an-fg)" }}>{card.name}</span>
                            </div>
                            <p className={skillsOneCol ? "mt-1 text-xs" : "mt-0.5 text-[10px]"} style={{ color: "var(--an-fg-mute)" }}>
                              {priceLabel(card.price)}{card.supply != null ? ` · ${card.supply} copies` : ""}
                            </p>
                          </div>
                        </button>
                      );
                    })}
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
                      <div key={n.id} className="rounded-xl border p-3 text-xs" style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)", color: "var(--an-fg-dim)" }}>
                        <div className="mb-1 flex items-center gap-2">
                          <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--an-bg-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(n.author) }} />
                          <span className="font-mono text-[10px]" style={{ color: "var(--an-fg-mute)" }}>{shortWallet(n.author)}</span>
                          {noteDate(n.timestamp) && <span className="ml-auto text-[10px]" style={{ color: "var(--an-fg-mute)" }}>{noteDate(n.timestamp)}</span>}
                        </div>
                        {mediaUrl(n.image) && <img src={mediaUrl(n.image)} alt="" referrerPolicy="no-referrer" className="mb-1.5 max-h-32 w-full rounded-lg object-cover" />}
                        {n.title && <p className="mb-0.5 text-xs font-bold" style={{ color: "var(--an-fg)" }}>{n.title}</p>}
                        {n.text && <p className="whitespace-pre-wrap break-words">{n.text}</p>}
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
        <div className="shrink-0 border-t p-3 an-tabbar-inset" style={{ borderColor: "var(--an-line)" }}>
          <button
            onClick={handleBuyAll}
            disabled={buyingAll}
            className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--an-green)", color: "var(--an-on-green)" }}
          >
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
