import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SkillCard, SkillDetail } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";

// The market actions, injected by Chat (which owns the marketplaceEnv built from the
// wallet). Same functions the VSCode market uses — we just drive them from a TUI.
export interface MarketApi {
  searchSkills(query: string, kind?: "skill" | "workflow"): Promise<SkillCard[]>;
  getSkillDetail(mint: string): Promise<SkillDetail>;
  buySkill(skillId: string, creatorWallet?: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  solBalance(): Promise<number | null>;
}

// "page"-like states so it reads as navigating into a screen and back (zo's ask):
//  list   → search box + result cards
//  detail → one skill's body + required skills + buy
//  confirm→ cost check before spending SOL (buy is irreversible)
type Stage = "list" | "detail" | "confirm";

const SOL = 1_000_000_000;
function sol(lamports: number | null): string {
  return lamports == null ? "—" : `${(lamports / SOL).toFixed(3)} SOL`;
}

// A self-contained skill market: search, list, detail, buy. ↑/↓ move, ↵ open/confirm,
// b buy, tab switch skills/workflows, / focus search, esc back-a-level (or close at list).
// Mirrors the VSCode market over the same marketplaceEnv functions.
export function SkillMarket({
  api,
  walletAddr,
  ownedNames,
  onBought,
  onClose,
}: {
  api: MarketApi;
  walletAddr: string;
  // installed skill slugs (so a card can show an "owned" badge). May be stale by a buy;
  // onBought lets Chat refresh it after a successful purchase.
  ownedNames: string[];
  onBought: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("list");
  const [kind, setKind] = useState<"skill" | "workflow">("skill");
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(true); // search box has the cursor (list stage)
  const [results, setResults] = useState<SkillCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); // a buy is in flight
  const [flash, setFlash] = useState<string | null>(null); // last buy outcome

  const owned = new Set(ownedNames);
  const clamped = Math.min(idx, Math.max(0, results.length - 1));
  const selected = results[clamped];

  // run a search (debounced by Enter / tab, not per-keystroke — keeps it cheap).
  async function search(q: string, k: "skill" | "workflow") {
    setLoading(true);
    setError(null);
    try {
      setResults(await api.searchSkills(q, k));
      setIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // initial load + balance.
  useEffect(() => {
    void search("", kind);
    void api.solBalance().then(setBalance).catch(() => setBalance(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDetail(mint: string) {
    setLoading(true);
    try {
      setDetail(await api.getSkillDetail(mint));
      setStage("detail");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function doBuy(card: SkillCard) {
    setBusy(true);
    setFlash(null);
    const res = await api.buySkill(card.id, card.creator);
    setBusy(false);
    if (res.ok) {
      setFlash(`acquired ${card.name}${res.slug ? ` → ${res.slug}` : ""}`);
      onBought();
      void api.solBalance().then(setBalance).catch(() => {});
      setStage("list");
      setDetail(null);
    } else {
      setFlash(`buy failed: ${res.error ?? "unknown error"}`);
      setStage("detail");
    }
  }

  useInput((input, key) => {
    if (busy) return; // ignore input while a buy is settling

    if (stage === "confirm") {
      const card = detail?.card ?? selected;
      if (key.escape || input === "n") return setStage(detail ? "detail" : "list");
      if (input === "y" || key.return) {
        if (card) void doBuy(card);
      }
      return;
    }

    if (stage === "detail") {
      if (key.escape) {
        setStage("list");
        setDetail(null);
        return;
      }
      if (input === "b" && detail && !owned.has(detail.card.name)) setStage("confirm");
      return;
    }

    // list stage
    if (key.escape) return onClose();
    // the search box owns text while typing; tab/↑/↓/↵ still navigate.
    if (typing) {
      if (key.return) {
        setTyping(false);
        void search(query, kind);
        return;
      }
      if (key.tab) {
        const next = kind === "skill" ? "workflow" : "skill";
        setKind(next);
        void search(query, next);
        return;
      }
      if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
      if (key.downArrow) return setTyping(false);
      if (input && !key.ctrl && !key.meta) return setQuery((q) => q + input);
      return;
    }
    // results navigation
    if (input === "/") return setTyping(true);
    if (key.tab) {
      const next = kind === "skill" ? "workflow" : "skill";
      setKind(next);
      void search(query, next);
      return;
    }
    if (key.upArrow) {
      if (clamped === 0) return setTyping(true);
      return setIdx((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) return setIdx((i) => Math.min(results.length - 1, i + 1));
    if (key.return && selected) return void openDetail(selected.id);
    if (input === "b" && selected && !owned.has(selected.name)) {
      setDetail(null);
      setStage("confirm");
    }
  });

  // ── confirm (cost check before spending SOL) ──────────────────────────────
  if (stage === "confirm") {
    const card = detail?.card ?? selected;
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.warn}>
        <Text bold color={colors.warn}>confirm purchase</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{card?.name}</Text>
          <Text dimColor>{card?.description}</Text>
          <Box marginTop={1}>
            <Text dimColor>supply </Text><Text>×{card?.supply ?? 0}</Text>
            <Text dimColor>   your balance </Text><Text>{sol(balance)}</Text>
          </Box>
          <Text dimColor>this signs an on-chain transaction and can't be undone</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={colors.warn}>buy “{card?.name}”?  </Text>
          <Text dimColor>[y] yes · [n] no</Text>
        </Box>
      </Box>
    );
  }

  // ── detail ────────────────────────────────────────────────────────────────
  if (stage === "detail" && detail) {
    const c = detail.card;
    const isOwned = owned.has(c.name);
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Box>
          <Text bold color={colors.iqCyan}>{c.name}</Text>
          <Text dimColor>  {c.type ?? "skill"} · ×{c.supply ?? 0}{isOwned ? " · owned" : ""}</Text>
        </Box>
        {c.description ? <Text>{c.description}</Text> : null}
        {c.category || (c.hashtags && c.hashtags.length) ? (
          <Box marginTop={1}>
            {c.category ? <Text color={colors.iqViolet}>{c.category} </Text> : null}
            {(c.hashtags ?? []).map((h) => (
              <Text key={h} dimColor>#{h} </Text>
            ))}
          </Box>
        ) : null}
        {detail.requiredCards.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>requires:</Text>
            {detail.requiredCards.map((r) => (
              <Text key={r.id}>  · {r.name}</Text>
            ))}
          </Box>
        ) : null}
        {detail.skillText ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>── SKILL.md ──</Text>
            <Text>{detail.skillText.slice(0, 1200)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text dimColor>
            {isOwned ? "owned · " : "[b] buy · "}[esc] back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── list ──────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box>
        <Text bold color={colors.iqMagenta}>❖ skill market</Text>
        <Text dimColor>   balance {sol(balance)}</Text>
      </Box>
      {/* tabs */}
      <Box marginTop={1}>
        <Text color={kind === "skill" ? colors.iqCyan : colors.dim} bold={kind === "skill"}>skills</Text>
        <Text dimColor>  ·  </Text>
        <Text color={kind === "workflow" ? colors.iqCyan : colors.dim} bold={kind === "workflow"}>workflows</Text>
      </Box>
      {/* search box */}
      <Box marginTop={1}>
        <Text color={typing ? colors.iqCyan : colors.dim}>{typing ? "▸ " : "  "}</Text>
        <Text dimColor>search </Text>
        <Text>{query}</Text>
        {typing ? <Text inverse> </Text> : null}
      </Box>
      {/* results */}
      <Box flexDirection="column" marginTop={1}>
        {loading ? (
          <Text dimColor>searching…</Text>
        ) : error ? (
          <Text color={colors.err}>{error}</Text>
        ) : results.length === 0 ? (
          <Text dimColor>no {kind === "skill" ? "skills" : "workflows"} found</Text>
        ) : (
          results.slice(0, 12).map((c, i) => {
            const on = !typing && i === clamped;
            const isOwned = owned.has(c.name);
            return (
              <Box key={c.id}>
                <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
                <Box width={26}>
                  <Text color={on ? colors.iqCyan : undefined} bold={on}>
                    {c.name.slice(0, 24)}
                  </Text>
                </Box>
                <Text dimColor>×{c.supply ?? 0} </Text>
                {isOwned ? <Text color={colors.ok}>owned </Text> : null}
                <Text dimColor>{(c.description ?? "").slice(0, 40)}</Text>
              </Box>
            );
          })
        )}
      </Box>
      {flash ? (
        <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          {typing
            ? "type to search · ↵ run · [tab] skills/workflows · ↓ results · esc close"
            : "↑/↓ move · ↵ open · [b] buy · [tab] switch · [/] search · esc close"}
        </Text>
      </Box>
    </Box>
  );
}
