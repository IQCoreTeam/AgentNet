// One file holds every color, glyph, mascot frame, label, and bit of copy in the CLI.
// Components read these tokens and never hardcode a color/emoji — so reskinning (or
// adding a second theme) is a single-file edit, and the playful voice stays consistent.

export const colors = {
  // IQ brand accents
  iqCyan: "#27e0d6",
  iqMagenta: "#ff5cf0",
  iqViolet: "#9b6cff",
  accent: "cyan",
  dim: "gray",
  ok: "green",
  warn: "yellow",
  err: "red",
  user: "cyan",
  claude: "#d97757", // claude's warm clay
  codex: "#10a37f", // codex green
} as const;

// ink-gradient supports named gradients; "vice" = cyan↔magenta = our IQ sweep.
export const gradients = {
  iq: ["#27e0d6", "#9b6cff", "#ff5cf0"],
} as const;

// Role glyphs shown before each transcript line.
export const glyph = {
  user: "▸",
  claude: "◇",
  codex: "◆",
  thinking: "◔",
  summary: "❖",
  // tool kinds
  bash: "⚡",
  edit: "✎",
  write: "✚",
  read: "◎",
  agent: "⟐",
  other: "•",
  ok: "✓",
  fail: "✗",
  sparkle: "✦",
} as const;

export const toolTint: Record<string, string> = {
  bash: colors.iqCyan,
  edit: colors.warn,
  write: colors.ok,
  read: colors.dim,
  agent: colors.iqMagenta,
  other: colors.dim,
};

// Iggy — the mascot. One face per mood; [a,b] = two blink frames where present.
export const iggy: Record<string, string[]> = {
  idle: ["◕‿◕", "◠‿◠"],
  thinking: ["◔_◔", "◔ _◔", "◔__◔"],
  tool: ["⚡◉_◉⚡", "⚡◉‿◉⚡"],
  success: ["◕▿◕"],
  error: ["◑︵◑"],
  sleeping: ["-‿- z", "-‿- zz", "-‿- zzz"],
  dance: ["♪┏(・o･)┛", "┗(･o･)┓♪", "♪┏(･o･)┛", "┗(･o･)┓♪", "ヽ(･o･)ﾉ", "♪ヽ(ﾟｰﾟ)ﾉ"],
} as const;

// Rotating labels while a turn runs — IQ-flavored, never the same boring "Loading…".
export const thinkingLabels = [
  "thinking…",
  "cooking…",
  "wiring neurons…",
  "consulting the hive…",
  "doing IQ things…",
  "compiling vibes…",
  "reticulating splines…",
];

// Own braille spinner frames (replaces ink-spinner) — animated via useFrameLoop.
export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// One-line celebration bursts (kept to a single line — delight, not noise).
export const confetti = "·  ✦  ˖  ✧  ·  ⋆  ·";

// Warm structural copy. Substance (tool output / diffs / errors) is NEVER routed here.
// All-custom ASCII/unicode — no emoji (renders consistently, keeps columns aligned).
export const copy = {
  wordmark: "AgentNet · the agent layer · iqlabs",
  tagline: "the agent layer",
  emptySessions: "no sessions yet — say hi",
  welcome: "✦ you're on the net",
  signoffs: [
    "brain saved. catch you on the net.",
    "logging off the hive. ttfn.",
    "session encrypted & tucked in. bye.",
  ],
  idleNudge: "…still here whenever you are",
  iqFacts: [
    "your session blob is the ONLY thing that lives off-chain — everything else is on-chain.",
    "a skill is a soulbound Token-2022 mint: supply = popularity, holders = owners.",
    "claude and codex sessions share one encrypted log — switch engines mid-thought.",
    "your wallet signature derives the key that encrypts every message you send.",
  ],
} as const;

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
