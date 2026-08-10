import React from "react";
import { Box, Text, useInput } from "ink";
import { HELIUS_QUICKSTART_URL } from "@iqlabs-official/agent-sdk";
import { colors, glyph, tag } from "../theme.js";

// Focusable rows, in order. settings first, then one row per owned skill, then the market
// entry. A single focus index walks all of them (Ctrl+S enters; [tab]/[↑↓] move). The
// key on a settings row drives onEdit; skill/market rows are handled by their own index.
export type PanelField = "wallet" | "cloud" | "engine" | "helius";
const SETTINGS: PanelField[] = ["wallet", "cloud", "engine", "helius"];

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

// One settings row, design-project style: `//WALLET_  ◉ value`. The focused row
// INVERTS (ink on bone) — the strongest focus signature the design uses.
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
  const bg = focused ? colors.bone : undefined;
  return (
    <Box>
      <Box width={11}>
        <Text backgroundColor={bg} color={focused ? colors.ink : colors.bone} bold>
          {tag(label)}
        </Text>
      </Box>
      <Text backgroundColor={bg} color={focused ? colors.ink : connected ? undefined : colors.dim}>
        {connected ? "◉" : "○"} {value}
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
  cloud: { kind: string; account?: string } | null;
  engine: "claude" | "codex";
  heliusMasked: string | null;
  skills: OwnedSkill[] | null;
  passive?: string[];
  dasReady: boolean;
  active: boolean;
  onEdit: (field: PanelField) => void;
  onSetHelius: (key: string) => void;
  onOpenMarket: () => void;
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
      if (field === "helius") return setKeyInput("");
      return onEdit(field);
    }
    if (i === marketIdx) return onOpenMarket();
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
      borderStyle="bold"
      borderColor={colors.bone}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      {/* mascot column (left) — kaomoji + dither texture, from the design project */}
      <Box flexDirection="column" marginRight={3} justifyContent="center" alignItems="center">
        <Text color={colors.bone}>{"( ◕ ◡ ◕ )"}</Text>
        <Text dimColor>{"⠐⠄ ░▒▓▓▒░ ⠂⠈░▒▒░ ⡀"}</Text>
        <Text dimColor>{" ⠈  ░░▒▒▒▒░░  ⠠⠁"}</Text>
        <Text dimColor>THE AGENT LAYER</Text>
      </Box>

      {/* welcome + editable settings (middle) */}
      <Box flexDirection="column" justifyContent="center" marginRight={3}>
        <Box marginBottom={1}>
          <Text bold color={colors.bone}>
            {tag(`welcome back${name ? " " + name : ""}`)}
          </Text>
        </Box>
        <SettingRow label="wallet" value={shortAddr} connected={!!walletAddr} focused={active && focus === 0} />
        <SettingRow label="cloud" value={cloudValue} connected={cloudConnected} focused={active && focus === 1} />
        <SettingRow label="engine" value={engine} connected focused={active && focus === 2} />
        {keyInput !== null ? (
          <Box>
            <Box width={11}><Text color={colors.iqCyan} bold>{tag("helius")}</Text></Box>
            <Text>{keyInput || ""}</Text>
            <Text inverse> </Text>
          </Box>
        ) : (
          <SettingRow
            label="helius"
            value={heliusMasked ?? "default rpc"}
            connected={!!heliusMasked}
            focused={active && focus === 3}
          />
        )}
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
          <Text bold color={colors.bone}>{tag(`skills${ownedList.length ? " " + ownedList.length : ""}`)}</Text>
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
                <Text
                  backgroundColor={on ? colors.bone : undefined}
                  color={on ? colors.ink : undefined}
                  bold={on}
                >
                  {glyph.sparkle} {s.name.toUpperCase()}
                </Text>
              </Box>
            );
          })
        )}
        <Box marginTop={1}>
          <Text
            backgroundColor={active && focus === marketIdx ? colors.bone : undefined}
            color={active && focus === marketIdx ? colors.ink : colors.dim}
            bold={active && focus === marketIdx}
          >
            ▸ MARKET
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
