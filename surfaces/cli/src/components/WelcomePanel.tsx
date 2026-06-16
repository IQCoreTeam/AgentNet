import React from "react";
import { Box, Text, useInput } from "ink";
import BigText from "ink-big-text";
import { colors, glyph } from "../theme.js";

// Focusable rows, in order. settings first, then one row per owned skill, then the market
// entry. A single focus index walks all of them (Ctrl+S enters; [tab]/[↑↓] move). The
// key on a settings row drives onEdit; skill/market rows are handled by their own index.
export type PanelField = "wallet" | "cloud" | "engine" | "github" | "helius";
const SETTINGS: PanelField[] = ["wallet", "cloud", "engine", "github", "helius"];

// Where to get a (free) Helius key — shown when the user opens the key editor.
const HELIUS_QUICKSTART = "https://www.helius.dev/docs/quickstart";

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

// One settings row: a focus caret, a status dot (filled = connected, hollow = not), a
// label, and a value. The focused row is bold + caret so [tab]/[enter] read at a glance.
function SettingRow({
  label,
  value,
  connected,
  focused,
}: {
  label: string;
  value: string;
  connected: boolean;
  focused: boolean;
}) {
  return (
    <Box>
      <Text color={focused ? colors.iqCyan : undefined}>{focused ? "▸ " : "  "}</Text>
      <Text color={connected ? colors.ok : colors.dim}>{connected ? "◉" : "○"} </Text>
      <Box width={8}>
        <Text color={focused ? colors.iqCyan : connected ? undefined : colors.dim} bold={focused}>
          {label}
        </Text>
      </Box>
      <Text dimColor={!connected} bold={focused}>
        {value}
      </Text>
    </Box>
  );
}

// The "welcome back" control panel: grid IQ mark (left), editable settings (middle), and a
// "my skills" column (right). The composer keeps focus until Ctrl+S; then a single focus
// index walks settings → owned skills → market. [enter] edits a setting, opens the market,
// or (on a skill) is a no-op for now. Editing helius switches the panel into a key-input
// line editor (onSetHelius commits). Esc returns focus to the composer.
export function WelcomePanel({
  name,
  walletAddr,
  cloud,
  engine,
  heliusMasked,
  skills,
  passive,
  dasReady,
  active,
  onEdit,
  onSetHelius,
  onOpenMarket,
  onExit,
}: {
  name?: string;
  walletAddr: string;
  // { kind, account? } from getStorageInfo(); null = local only (no cloud mirror).
  cloud: { kind: string; account?: string } | null;
  engine: "claude" | "codex";
  // maskedHeliusKey() → "••••AB12", or null when no key is set.
  heliusMasked: string | null;
  // the wallet's owned skills (hydrated id+name). null = still loading; [] = none owned.
  skills: OwnedSkill[] | null;
  // bundled/built-in skill slugs present on disk (skill-shopping, make-skill). Rendered as
  // a small plain list — these aren't bought NFTs, so no color/effects and not focusable.
  passive?: string[];
  // hasDasRpc(): false on the public default RPC, which can't read owned skills.
  // Lets the empty state say "set a Helius key" instead of a misleading "none yet".
  dasReady: boolean;
  // when true, the panel has focus and owns tab/arrow/enter (entered via Ctrl+S in Chat).
  active: boolean;
  onEdit: (field: PanelField) => void;
  // commit a new Helius key (raw — SDK normalizes URL/bare). "" clears it (use default RPC).
  onSetHelius: (key: string) => void;
  onOpenMarket: () => void;
  // Esc leaves the panel and returns focus to the composer.
  onExit: () => void;
}) {
  const [focus, setFocus] = React.useState(0);
  // helius key-entry mode: when set, the panel is a line editor capturing the new key.
  const [keyInput, setKeyInput] = React.useState<string | null>(null);

  // null = still loading; treat as no focusable skill rows until it resolves.
  const ownedList = skills ?? [];
  // the full focus list: settings rows, then a row per skill, then the market entry.
  const total = SETTINGS.length + ownedList.length + 1;
  const marketIdx = total - 1;
  const skillStart = SETTINGS.length;

  function activate(i: number) {
    if (i < SETTINGS.length) {
      const field = SETTINGS[i];
      if (field === "helius") return setKeyInput(""); // open the key line editor (blank)
      return onEdit(field);
    }
    if (i === marketIdx) return onOpenMarket();
    // a skill row — nothing to do yet (detail/market view comes later).
  }

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
      if (key.tab && key.shift) return setFocus((f) => (f + total - 1) % total);
      if (key.tab || key.downArrow) return setFocus((f) => (f + 1) % total);
      if (key.upArrow) return setFocus((f) => (f + total - 1) % total);
      if (key.return) return activate(focus);
    },
    { isActive: active },
  );

  const shortAddr = walletAddr
    ? `${walletAddr.slice(0, 4)}…${walletAddr.slice(-4)}`
    : "(not connected)";
  const cloudConnected = !!cloud && cloud.kind !== "local";
  const cloudValue = cloudConnected
    ? `${cloud!.kind}${cloud!.account ? ` (${cloud!.account})` : ""}`
    : "local only";

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor={colors.ok}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      {/* IQ wordmark (left) — grid font, our green. */}
      <Box flexDirection="column" marginRight={3} justifyContent="center">
        <BigText text="IQ" font="grid" colors={[colors.ok]} space={false} />
        <Text dimColor>the agent layer</Text>
      </Box>

      {/* welcome + editable settings (middle) */}
      <Box flexDirection="column" justifyContent="center" marginRight={3}>
        <Box marginBottom={1}>
          <Text bold color={colors.iqCyan}>
            Welcome back{name ? ` ${name}` : ""}!
          </Text>
        </Box>
        <SettingRow label="wallet" value={shortAddr} connected={!!walletAddr} focused={active && focus === 0} />
        <SettingRow label="cloud" value={cloudValue} connected={cloudConnected} focused={active && focus === 1} />
        <SettingRow label="engine" value={engine} connected focused={active && focus === 2} />
        <SettingRow label="github" value="not linked" connected={false} focused={active && focus === 3} />
        {keyInput !== null ? (
          <Box>
            <Text color={colors.iqCyan}>{"▸ "}</Text>
            <Box width={8}><Text color={colors.iqCyan} bold>helius</Text></Box>
            <Text>{keyInput || ""}</Text>
            <Text inverse> </Text>
          </Box>
        ) : (
          <SettingRow
            label="helius"
            value={heliusMasked ?? "default rpc"}
            connected={!!heliusMasked}
            focused={active && focus === 4}
          />
        )}
        {keyInput !== null ? (
          // key-entry mode: walk the user through getting a key + where it goes.
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              1. get a free key at{" "}
              <Text color={colors.iqCyan}>{link(HELIUS_QUICKSTART, HELIUS_QUICKSTART)}</Text>
            </Text>
            <Text dimColor> (⌘/ctrl-click the link, then copy your API key)</Text>
            <Text dimColor>2. paste it on the line above — the key or the full RPC URL</Text>
            <Text dimColor>3. [enter] save · [esc] cancel · empty = use default rpc</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>
              {glyph.sparkle}{" "}
              {active ? "[tab] move · [enter] edit · [esc] chat" : "[ctrl+s] settings"}
            </Text>
          </Box>
        )}
      </Box>

      {/* my skills (right) */}
      <Box flexDirection="column" justifyContent="center">
        <Box marginBottom={1}>
          <Text bold color={colors.iqViolet}>my skills{ownedList.length ? ` (${ownedList.length})` : ""}</Text>
        </Box>
        {skills === null ? (
          // still fetching — don't show "none yet" before the read resolves.
          <Text dimColor>loading…</Text>
        ) : ownedList.length === 0 ? (
          dasReady ? (
            <Text dimColor>none yet</Text>
          ) : (
            // public default RPC can't read owned skills — point the user at the key row.
            <Box flexDirection="column">
              <Text color={colors.iqViolet}>set a Helius key to see your skills</Text>
              <Text dimColor>the default RPC can't read NFTs · edit the helius row</Text>
            </Box>
          )
        ) : (
          ownedList.map((s, i) => {
            const idx = skillStart + i;
            const on = active && focus === idx;
            return (
              <Box key={s.id}>
                <Text color={on ? colors.iqCyan : undefined}>{on ? "▸ " : "  "}</Text>
                <Text color={on ? colors.iqCyan : undefined} bold={on}>{s.name}</Text>
              </Box>
            );
          })
        )}
        <Box marginTop={1}>
          <Text color={active && focus === marketIdx ? colors.iqCyan : colors.dim} bold={active && focus === marketIdx}>
            {active && focus === marketIdx ? "▸ " : "  "}→ open market
          </Text>
        </Box>

        {/* built-in skills (skill-shopping, make-skill): a small plain list, set apart from
            owned NFTs — no color, no effects, not focusable. They ship with the app. */}
        {passive && passive.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>built-in</Text>
            {passive.map((slug) => (
              <Text key={slug} dimColor>
                {"  · "}
                {slug}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
