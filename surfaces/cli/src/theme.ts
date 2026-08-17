// One file holds every color, glyph, mascot frame, label, and bit of copy in the CLI.
// Components read these tokens and never hardcode a color/emoji — so reskinning (or
// adding a second theme) is a single-file edit, and the playful voice stays consistent.

// Industrial mono palette (from the claude.ai/design "AgentNet CLI Screens" project):
// bone white on near-black, warm gray for structure, ONE signal green accent. The old
// cyan/magenta/violet keys are kept as aliases so every component reskins in place.
export const colors = {
  iqCyan: "#3fd96f", // primary accent (signal green)
  iqMagenta: "#ecebe4", // titles / emphasis (bone)
  iqViolet: "#85857e", // thinking / secondary labels (warm gray)
  accent: "#3fd96f",
  dim: "#85857e",
  ok: "#3fd96f",
  warn: "#e3b341",
  err: "#f8514f",
  user: "#ecebe4",
  claude: "#ecebe4", // engines are monochrome; glyphs (◇/◆) carry identity
  codex: "#ecebe4",
  bone: "#ecebe4",
  ink: "#0a0a0b",
  danger: "#ff3b30", // hard danger (destructive command / gated), distinct from err text
} as const;

// Reputation metals: the tier ladder's visual identity (design tab 20's rank column).
// Each rank owns one truecolor tone that reads distinctly on the near-black ground:
// bronze is a copper, silver a cool grey-white (cooler than bone so the two never blur),
// gold the warm gold the palette already knows, legendary the signal green the ladder
// legend teaches. Every screen that shows a rank routes through tierColor so a badge,
// a ladder rung, and the legend can never disagree about what a tier looks like.
export const tierColors: Record<string, string> = {
  bronze: "#cd7f32",
  silver: "#c8ccd4",
  gold: "#e3b341",
  legendary: "#3fd96f",
};

// tierColor("Gold") → that rank's tone; unranked/unknown falls back to structural grey.
export const tierColor = (name?: string | null): string =>
  (name && tierColors[name.toLowerCase()]) || colors.dim;

// Structural surfaces from the design that are NOT brand colors: the panel backgrounds,
// rails, and separators used to LAYER a panel above the chat (the design's overlays rise
// out of the footer instead of replacing the frame). Kept apart from `colors` so the brand
// palette and the structural greys never get confused.
export const surface = {
  locked: "#4a4a46", // a locked / not-yet-reached step (onboarding ladder)
  rail: "#3a3a38", // heavy left rail on replies, separators between session tabs
  pastHeader: "#2a2a28", // a scrolled-past turn header (long chat)
  codeBg: "#101013", // inline code box background
  panelBg: "#0e1410", // a panel that rises above the composer (green-tinted near-black)
  panelSep: "#24352a", // row separator inside a risen panel
  panelSepDim: "#16201a", // the fainter separator inside a risen panel
  forkHere: "#1a2a1f", // the "up to here" marker highlight on a fork
  successBg: "#0f1a12", // the green "wallet linked" success band (onboarding)
} as const;

// Section rule — the heavy horizontal line that separates every band of the frame.
export const rule = (w: number): string => "━".repeat(Math.max(0, w));

// Industrial label: `tag("wallet")` → "//WALLET_"
export const tag = (s: string): string => `//${s.toUpperCase()}_`;

// ink-gradient supports named gradients; "vice" = cyan↔magenta = our IQ sweep.
export const gradients = {
  iq: ["#27e0d6", "#9b6cff", "#ff5cf0"],
} as const;

// Diff shading — bright fg on a dark tinted bg, Claude-Code style (added=green block,
// removed=red block). Padded to a rectangle by the renderer so the bands look clean.
export const diff = {
  addFg: "#9be9a8",
  addBg: "#16351f",
  delFg: "#ff9aa2",
  delBg: "#3a151b",
  hunk: "#9b6cff", // @@ headers
} as const;

// Role glyphs shown before each transcript line.
export const glyph = {
  user: "▸",
  claude: "◇",
  codex: "◆",
  thinking: "◔",
  summary: "❖",
  // tool kinds
  bash: "$",
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
  tool: ["◉_◉", "◉‿◉"],
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

export const castingFrames = ["✦ ·   · ✧", "· ✧ ·   ✦", "  ✦ · ✧  ", "·   ✦ · ✧"];

// One-line celebration bursts (kept to a single line — delight, not noise).
export const confetti = "·  ✦  ˖  ✧  ·  ⋆  ·";

// Warm structural copy. Substance (tool output / diffs / errors) is NEVER routed here.
// All-custom ASCII/unicode — no emoji (renders consistently, keeps columns aligned).
export const copy = {
  wordmark: "AgentNet · the agent layer · iqlabs",
  tagline: "the agent layer",
  emptySessions: "no sessions yet... say hi",
  welcome: "✦ you're on the net",
  signoffs: [
    "brain saved. catch you on the net.",
    "logging off the hive. ttfn.",
    "session encrypted & tucked in. bye.",
  ],
  idleNudge: "…still here whenever you are",
  iqFacts: [
    "your session blob is the ONLY thing that lives off-chain; everything else is on-chain.",
    "a skill is a soulbound Token-2022 mint: supply = popularity, holders = owners.",
    "claude and codex sessions share one encrypted log; switch engines mid-thought.",
    "your wallet signature derives the key that encrypts every message you send.",
  ],
  castingVerbs: ["casting", "channeling", "wielding", "invoking"],
  castingLabel: "nft skill",
} as const;

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
