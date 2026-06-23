import type { CSSProperties, SVGProps } from "react";
import { IQ_LOGO_SVG } from "@iqlabs-official/agent-sdk/chat/ui/iqlogo";

// Drawn SVG icons that replace the decorative emoji the UI used to lean on
// (🔮 ✨ ⭐ 🎉 📷 🤖 ⚠️ 📎). Each inherits color via `currentColor` and size from
// className (e.g. "h-5 w-5"), so they restyle like text rather than like emoji.

type IconProps = SVGProps<SVGSVGElement>;

// The IQ Labs brand mark — the SAME logo the VSCode extension renders. The SVG fills with
// currentColor and is 100%×100% of its box, so set the size on the wrapper (h-/w- classes)
// and tint via `color`/`style.color`. Used as the empty-chat watermark and drawer header.
export function IqLogo({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ display: "inline-flex", lineHeight: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: IQ_LOGO_SVG }}
    />
  );
}

// Skill / "magic" mark — a clean four-point sparkle. Replaces 🔮 (skill avatar) and the
// ✦ / ⭐ / ✨ stars in the approval card and the buy/publish celebration.
export function SkillIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2 14.4 9.6 22 12 14.4 14.4 12 22 9.6 14.4 2 12 9.6 9.6Z" />
    </svg>
  );
}

// Photo / image — replaces 📷 (publish cover-image picker).
export function ImageIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m3.5 17 4.5-4.5 3.5 3.5 4-4 5 5" />
    </svg>
  );
}

// Agent — a simple robot head. Replaces 🤖 (directory) and 🔮 (profile avatar).
export function AgentIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="4.5" y="8" width="15" height="11" rx="3" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.8" r="1.2" />
      <path d="M9.5 13h.01M14.5 13h.01" />
      <path d="M10 16.2h4" />
    </svg>
  );
}

// Warning — triangle + bang. Replaces ⚠️ (publish-failed state).
export function WarningIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3.5 21 19.5H3L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// Paperclip attach — replaces 📎 (composer image attach).
export function AttachIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.5 10.5 11 18a4 4 0 1 1-5.7-5.7l7.6-7.6a2.6 2.6 0 0 1 3.7 3.7l-7.6 7.6a1.2 1.2 0 0 1-1.7-1.7l6.9-6.9" />
    </svg>
  );
}

// Chat bubble — tab: Chat (the core loop).
export function ChatIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20.5 11.5a7.5 7 0 0 1-7.5 7 8 8 0 0 1-3.4-.75L4.5 19l1.1-3.7A6.9 6.9 0 0 1 4.5 11.5 7.5 7 0 0 1 12 4.5a7.5 7 0 0 1 8.5 7Z" />
    </svg>
  );
}

// Shopping bag — tab: Market (browse / buy).
export function MarketIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6.2 8h11.6l-1 10.4A1.7 1.7 0 0 1 15.1 20H8.9a1.7 1.7 0 0 1-1.7-1.6L6.2 8Z" />
      <path d="M9 8V6.6a3 3 0 0 1 6 0V8" />
    </svg>
  );
}

// 2x2 grid — tab: My Skills (the owned collection).
export function CollectionIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </svg>
  );
}
