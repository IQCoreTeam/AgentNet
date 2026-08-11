import React from "react";
import { Box, Text, useInput } from "ink";
import { HELIUS_QUICKSTART_URL } from "@iqlabs-official/agent-sdk";
import { colors, glyph, rule, tag } from "../theme.js";
import { displayWidth } from "../format.js";

// Focusable rows, in order: the four settings bands, then the skills band (enter = market).
export type PanelField = "wallet" | "cloud" | "engine" | "helius";
const SETTINGS: PanelField[] = ["wallet", "cloud", "engine", "helius"];
const SKILLS_IDX = SETTINGS.length;
const FOCUS_TOTAL = SKILLS_IDX + 1;

// A clickable terminal hyperlink (OSC 8). Modern terminals (iTerm2, VS Code,
// kitty, …) render `label` underlined and open `url` on ⌘/Ctrl-click; the rest
// just show the label, so we keep the raw URL visible separately as a fallback.
function link(label: string, url: string): string {
  return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}

export interface OwnedSkill {
  id: string;
  name: string;
}

function truncate(s: string, w: number): string {
  if (displayWidth(s) <= w) return s;
  let head = s;
  while (head.length > 1 && displayWidth(`${head}…`) > w) head = head.slice(0, -1);
  return `${head}…`;
}

// One config band, the design's row silhouette (tab 03): `//TAG_` on the left, the value
// on the right edge, and the focused band FULLY inverted (ink on bone, edge to edge) —
// the design's strongest focus signature.
function Band({
  width,
  label,
  value,
  dim,
  focused,
}: {
  width: number;
  label: string;
  value: string;
  dim?: boolean;
  focused: boolean;
}) {
  const left = ` ${tag(label)}`;
  const fitted = truncate(value, Math.max(4, width - displayWidth(left) - 3));
  if (focused) {
    const gap = Math.max(1, width - displayWidth(left) - displayWidth(fitted) - 1);
    return (
      <Text backgroundColor={colors.bone} color={colors.ink} bold>
        {left + " ".repeat(gap) + fitted + " "}
      </Text>
    );
  }
  return (
    <Box width={width} justifyContent="space-between">
      <Text bold color={dim ? colors.dim : colors.bone}>{left}</Text>
      <Text color={dim ? colors.dim : undefined}>{fitted + " "}</Text>
    </Box>
  );
}

// The skills band's inline value: `✦ OWNED · ✦ built-in · ▸ MARKET`, greedily fitted to
// one row (the design lays skills HORIZONTALLY in a single band). Owned skills read at
// full strength, built-ins dim; whatever doesn't fit collapses into `+N`.
function fitSkills(
  owned: OwnedSkill[],
  builtIn: string[],
  width: number,
): { pieces: Array<{ text: string; dim: boolean }>; plain: string } {
  const market = "▸ MARKET";
  const items = [
    ...owned.map((s) => ({ text: `${glyph.sparkle} ${s.name.toUpperCase()}`, dim: false })),
    ...builtIn.map((slug) => ({ text: `${glyph.sparkle} ${slug}`, dim: true })),
  ];
  const pieces: Array<{ text: string; dim: boolean }> = [];
  let used = displayWidth(market);
  let taken = 0;
  for (const item of items) {
    const left = items.length - taken - 1;
    const reserve = left > 0 ? displayWidth(` · +${left}`) : 0;
    const cost = displayWidth(`${item.text} · `);
    if (used + cost + reserve > width) break;
    pieces.push({ text: `${item.text} · `, dim: item.dim });
    used += cost;
    taken++;
  }
  const hidden = items.length - taken;
  if (hidden > 0) pieces.push({ text: `+${hidden} · `, dim: true });
  pieces.push({ text: market, dim: true });
  return { pieces, plain: pieces.map((p) => p.text).join("") };
}

// The welcome region, tab 03 of the design: a logo column on the left behind a bold rail,
// and full-width config bands stacked on the right — wallet, cloud, engine, helius, skills
// — separated by bone rules, the focused band inverted. The composer keeps focus until
// Ctrl+S; then tab/↑↓ walk the bands, [enter] edits (or opens the market from the skills
// band), Esc returns to the composer. Editing helius turns its band into a key editor.
export function WelcomePanel({
  walletAddr,
  cloud,
  engine,
  heliusMasked,
  skills,
  passive,
  dasReady,
  active,
  maxRows,
  onEdit,
  onSetHelius,
  onOpenMarket,
  onExit,
}: {
  walletAddr: string;
  cloud: { kind: string; account?: string } | null;
  engine: "claude" | "codex";
  heliusMasked: string | null;
  skills: OwnedSkill[] | null;
  passive?: string[];
  dasReady: boolean;
  active: boolean;
  // Height budget handed down by Chat (which owns the frame budget). The panel's height
  // is fixed — skills lay horizontally — so the budget only decides whether the bone
  // rules between bands fit or the bands pack tight.
  maxRows?: number;
  onEdit: (field: PanelField) => void;
  onSetHelius: (key: string) => void;
  onOpenMarket: () => void;
  onExit: () => void;
}) {
  const [focus, setFocus] = React.useState(0);
  // helius key-entry mode: when set, the panel is a line editor capturing the new key.
  const [keyInput, setKeyInput] = React.useState<string | null>(null);

  useInput(
    (input, key) => {
      // helius key editor owns input while open.
      if (keyInput !== null) {
        if (key.escape) return setKeyInput(null);
        if (key.return) {
          onSetHelius(keyInput.trim());
          return setKeyInput(null);
        }
        if (key.backspace || key.delete) return setKeyInput((k) => (k ?? "").slice(0, -1));
        if (input && !key.ctrl && !key.meta) return setKeyInput((k) => (k ?? "") + input);
        return;
      }
      if (key.escape) return onExit();
      if (key.tab && key.shift) return setFocus((f) => (f + FOCUS_TOTAL - 1) % FOCUS_TOTAL);
      if (key.tab || key.downArrow) return setFocus((f) => (f + 1) % FOCUS_TOTAL);
      if (key.upArrow) return setFocus((f) => (f + FOCUS_TOTAL - 1) % FOCUS_TOTAL);
      if (key.return) {
        if (focus === SKILLS_IDX) return onOpenMarket();
        const field = SETTINGS[focus];
        if (field === "helius") return setKeyInput("");
        return onEdit(field);
      }
    },
    { isActive: active },
  );

  const mascot = ["( ◕ ◡ ◕ )", "⠐⠄ ░▒▓▓▒░ ⠂⠈░▒▒░ ⡀", " ⠈  ░░▒▒▒▒░░  ⠠⠁", "THE AGENT LAYER"];
  const leftW = Math.max(...mascot.map(displayWidth)) + 2; // paddingX(1) each side

  const cols = process.stdout.columns || 80;
  // Frame paddingX(2) outside, own bold border(2) + left column + its rail(1) inside.
  const bandW = Math.max(24, cols - 2 - 2 - leftW - 1);

  // The bone rules between bands are part of the silhouette but cost 4 rows; on a short
  // terminal the bands pack tight instead. Full height: 5 bands + 4 rules + hint + border.
  const withRules = (maxRows ?? 99) >= 12;

  const shortAddr = walletAddr
    ? `${walletAddr.slice(0, 4)}…${walletAddr.slice(-4)}`
    : "○ not connected";
  const cloudConnected = !!cloud && cloud.kind !== "local";

  const owned = skills ?? [];
  const skillsValue =
    skills === null
      ? { pieces: [{ text: "loading…", dim: true }], plain: "loading…" }
      : owned.length === 0 && !dasReady
        ? {
            pieces: [{ text: "set a helius key to see your skills", dim: true }],
            plain: "set a helius key to see your skills",
          }
        : fitSkills(owned, passive ?? [], bandW - displayWidth(` ${tag("skills")}`) - 3);

  const bands: React.ReactNode[] = [
    <Band
      key="wallet"
      width={bandW}
      label="wallet"
      value={walletAddr ? `◉ ${shortAddr}` : shortAddr}
      dim={!walletAddr}
      focused={active && focus === 0}
    />,
    <Band
      key="cloud"
      width={bandW}
      label="cloud"
      value={cloudConnected ? `◉ ${cloud!.kind.toUpperCase()}${cloud!.account ? ` (${cloud!.account.toUpperCase()})` : ""}` : "○ LOCAL ONLY"}
      dim={!cloudConnected}
      focused={active && focus === 1}
    />,
    <Band
      key="engine"
      width={bandW}
      label="engine"
      value={engine.toUpperCase()}
      focused={active && focus === 2}
    />,
    keyInput !== null ? (
      <Box key="helius">
        <Text color={colors.iqCyan} bold>{` ${tag("helius")} `}</Text>
        <Text>{keyInput}</Text>
        <Text inverse> </Text>
      </Box>
    ) : (
      <Band
        key="helius"
        width={bandW}
        label="helius"
        value={heliusMasked ? `◉ ${heliusMasked}` : "○ DEFAULT RPC"}
        dim={!heliusMasked}
        focused={active && focus === 3}
      />
    ),
    focus === SKILLS_IDX && active ? (
      <Band key="skills" width={bandW} label="skills" value={skillsValue.plain} focused />
    ) : (
      <Box key="skills" width={bandW}>
        <Text bold color={colors.bone}>{` ${tag("skills")}  `}</Text>
        <Text>
          {skillsValue.pieces.map((p, i) => (
            <Text key={i} color={p.dim ? colors.dim : undefined}>{p.text}</Text>
          ))}
        </Text>
      </Box>
    ),
  ];

  return (
    <Box flexDirection="row" borderStyle="bold" borderColor={colors.bone} marginBottom={1}>
      {/* logo column behind a bold rail, the design's 280px left cell */}
      <Box
        flexDirection="column"
        paddingX={1}
        justifyContent="center"
        alignItems="center"
        borderStyle="bold"
        borderColor={colors.bone}
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
      >
        <Text color={colors.bone}>{mascot[0]}</Text>
        <Text dimColor>{mascot[1]}</Text>
        <Text dimColor>{mascot[2]}</Text>
        <Text dimColor>{mascot[3]}</Text>
      </Box>

      {/* stacked config bands */}
      <Box flexDirection="column" justifyContent="center">
        {bands.map((band, i) => (
          <React.Fragment key={i}>
            {i > 0 && withRules ? <Text color={colors.bone}>{rule(bandW)}</Text> : null}
            {band}
          </React.Fragment>
        ))}
        {keyInput !== null ? (
          // key-entry mode: walk the user through getting a key + where it goes.
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              1. get a free key at{" "}
              <Text color={colors.iqCyan}>{link(HELIUS_QUICKSTART_URL, HELIUS_QUICKSTART_URL)}</Text>
            </Text>
            <Text dimColor> (⌘/ctrl-click the link, then copy your API key)</Text>
            <Text dimColor>2. paste it on the line above: the key or the full RPC URL</Text>
            <Text dimColor>3. [enter] save · [esc] cancel · empty = use default rpc</Text>
          </Box>
        ) : (
          <Text dimColor>
            {" "}{active ? "[tab] move · [enter] edit · [esc] chat" : "[ctrl+s] settings"}
          </Text>
        )}
      </Box>
    </Box>
  );
}
