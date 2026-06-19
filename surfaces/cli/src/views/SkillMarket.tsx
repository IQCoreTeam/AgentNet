import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { MarketItemType, SkillCard, SkillDetail } from "@iqlabs-official/agent-sdk";
import type { Reputation, AgentProfile } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";

export interface MarketApi {
  searchSkills(query: string, kind?: MarketItemType): Promise<SkillCard[]>;
  getSkillDetail(mint: string): Promise<SkillDetail>;
  buySkill(skillId: string, creatorWallet?: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  solBalance(): Promise<number | null>;
  postNote(skillId: string, skillType: MarketItemType | undefined, text: string, gitLink?: string): Promise<{ ok: boolean; error?: string }>;
  publishSkill(input: { name: string; description: string; text: string; category?: string; hashtags?: string[]; priceSol: string }): Promise<{ ok: boolean; mint?: string; error?: string }>;
  listAgents(): Promise<Reputation[]>;
  getAgentProfile(wallet: string): Promise<AgentProfile>;
  buyAllSkills(agentWallet: string): Promise<{ ok: boolean; bought: number; failed: number; error?: string }>;
}

type Stage =
  | "list"
  | "detail"
  | "confirm"
  | "comment"
  | "publish"
  | "agents"
  | "agentProfile";

// Publish form fields in order — tab/arrow cycles through them.
type PublishField = "name" | "desc" | "text" | "category" | "hashtags" | "price";
const PUBLISH_FIELDS: PublishField[] = ["name", "desc", "text", "category", "hashtags", "price"];

const SOL = 1_000_000_000;
function sol(lamports: number | null): string {
  return lamports == null ? "—" : `${(lamports / SOL).toFixed(3)} SOL`;
}
const MARKET_KINDS: MarketItemType[] = ["skill", "workflow", "plugin"];
function nextMarketKind(kind: MarketItemType): MarketItemType {
  return MARKET_KINDS[(MARKET_KINDS.indexOf(kind) + 1) % MARKET_KINDS.length];
}

export function SkillMarket({
  api,
  walletAddr,
  ownedNames,
  onBought,
  onClose,
}: {
  api: MarketApi;
  walletAddr: string;
  ownedNames: string[];
  onBought: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("list");
  const [kind, setKind] = useState<MarketItemType>("skill");
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(true);
  const [results, setResults] = useState<SkillCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // comment stage
  const [commentText, setCommentText] = useState("");
  const [commentGitLink, setCommentGitLink] = useState("");
  const [commentField, setCommentField] = useState<"text" | "gitLink">("text");

  // publish stage
  const [pubField, setPubField] = useState<PublishField>("name");
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubText, setPubText] = useState("");
  const [pubCategory, setPubCategory] = useState("");
  const [pubHashtags, setPubHashtags] = useState("");
  const [pubPrice, setPubPrice] = useState("0.1");
  const [pubResult, setPubResult] = useState<string | null>(null);

  // agents stage
  const [agents, setAgents] = useState<Reputation[]>([]);
  const [agentIdx, setAgentIdx] = useState(0);
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
  const [agentBuyResult, setAgentBuyResult] = useState<string | null>(null);

  const owned = new Set(ownedNames);
  const clamped = Math.min(idx, Math.max(0, results.length - 1));
  const selected = results[clamped];

  async function search(q: string, k: MarketItemType) {
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

  async function doComment() {
    if (!detail || !commentText.trim()) return;
    setBusy(true);
    const res = await api.postNote(
      detail.card.id,
      detail.card.type,
      commentText.trim(),
      commentGitLink.trim() || undefined,
    );
    setBusy(false);
    if (res.ok) {
      setFlash("comment posted");
      setCommentText("");
      setCommentGitLink("");
      setStage("detail");
    } else {
      setFlash(`comment failed: ${res.error ?? "unknown"}`);
    }
  }

  async function doPublish() {
    if (!pubName.trim() || !pubDesc.trim() || !pubText.trim()) return;
    setBusy(true);
    const res = await api.publishSkill({
      name: pubName.trim(),
      description: pubDesc.trim(),
      text: pubText.trim(),
      category: pubCategory.trim() || undefined,
      hashtags: pubHashtags.trim() ? pubHashtags.split(",").map((h) => h.trim()).filter(Boolean) : undefined,
      priceSol: pubPrice.trim() || "0.1",
    });
    setBusy(false);
    if (res.ok) {
      setPubResult(`published! mint: ${res.mint ?? "?"}`);
    } else {
      setPubResult(`failed: ${res.error ?? "unknown"}`);
    }
  }

  async function loadAgents() {
    setLoading(true);
    try {
      setAgents(await api.listAgents());
      setAgentIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openAgentProfile(wallet: string) {
    setLoading(true);
    try {
      setAgentProfile(await api.getAgentProfile(wallet));
      setStage("agentProfile");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function doBuyAll(wallet: string) {
    setBusy(true);
    setAgentBuyResult(null);
    const res = await api.buyAllSkills(wallet);
    setBusy(false);
    if (res.ok) {
      setAgentBuyResult(`bought ${res.bought} skill${res.bought !== 1 ? "s" : ""}${res.failed ? `, ${res.failed} failed` : ""}`);
      onBought();
    } else {
      setAgentBuyResult(`failed: ${res.error ?? "unknown"}`);
    }
  }

  // get/set helpers for publish form fields
  function pubGet(f: PublishField) {
    return { name: pubName, desc: pubDesc, text: pubText, category: pubCategory, hashtags: pubHashtags, price: pubPrice }[f];
  }
  function pubSet(f: PublishField, v: string) {
    ({ name: setPubName, desc: setPubDesc, text: setPubText, category: setPubCategory, hashtags: setPubHashtags, price: setPubPrice }[f])(v);
  }

  useInput((input, key) => {
    if (busy) return;

    // ── agent profile ──────────────────────────────────────────────────────
    if (stage === "agentProfile") {
      if (key.escape) { setStage("agents"); setAgentProfile(null); setAgentBuyResult(null); }
      if (input === "b" && agentProfile) void doBuyAll(agentProfile.reputation.wallet);
      return;
    }

    // ── agents list ────────────────────────────────────────────────────────
    if (stage === "agents") {
      if (key.escape) { setStage("list"); setAgents([]); setError(null); return; }
      if (key.upArrow) return setAgentIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) return setAgentIdx((i) => Math.min(agents.length - 1, i + 1));
      if (key.return && agents[agentIdx]) void openAgentProfile(agents[agentIdx].wallet);
      return;
    }

    // ── publish ────────────────────────────────────────────────────────────
    if (stage === "publish") {
      if (pubResult) {
        if (key.escape || key.return) { setPubResult(null); setStage("list"); }
        return;
      }
      if (key.escape) { setStage("list"); return; }
      const fi = PUBLISH_FIELDS.indexOf(pubField);
      if (key.tab || key.downArrow) {
        setPubField(PUBLISH_FIELDS[(fi + 1) % PUBLISH_FIELDS.length]);
        return;
      }
      if (key.upArrow) {
        setPubField(PUBLISH_FIELDS[(fi + PUBLISH_FIELDS.length - 1) % PUBLISH_FIELDS.length]);
        return;
      }
      if (key.return) {
        if (fi < PUBLISH_FIELDS.length - 1) {
          setPubField(PUBLISH_FIELDS[fi + 1]);
        } else {
          void doPublish();
        }
        return;
      }
      if (key.backspace || key.delete) { pubSet(pubField, pubGet(pubField).slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { pubSet(pubField, pubGet(pubField) + input); return; }
      return;
    }

    // ── comment ────────────────────────────────────────────────────────────
    if (stage === "comment") {
      if (key.escape) { setStage("detail"); return; }
      if (key.tab || key.downArrow) {
        setCommentField((f) => f === "text" ? "gitLink" : "text");
        return;
      }
      if (key.return && commentField === "gitLink") { void doComment(); return; }
      if (key.return) { setCommentField("gitLink"); return; }
      const setter = commentField === "text" ? setCommentText : setCommentGitLink;
      const cur = commentField === "text" ? commentText : commentGitLink;
      if (key.backspace || key.delete) { setter(cur.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setter(cur + input); return; }
      return;
    }

    // ── confirm ────────────────────────────────────────────────────────────
    if (stage === "confirm") {
      const card = detail?.card ?? selected;
      if (key.escape || input === "n") return setStage(detail ? "detail" : "list");
      if (input === "y" || key.return) {
        if (card) void doBuy(card);
      }
      return;
    }

    // ── detail ─────────────────────────────────────────────────────────────
    if (stage === "detail") {
      if (key.escape) { setStage("list"); setDetail(null); return; }
      if (input === "b" && detail && detail.card.type !== "plugin" && !owned.has(detail.card.name)) { setStage("confirm"); return; }
      if (input === "c" && detail) {
        setCommentText(""); setCommentGitLink(""); setCommentField("text");
        setStage("comment");
        return;
      }
      return;
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (key.escape) return onClose();
    if (typing) {
      if (key.return) { setTyping(false); void search(query, kind); return; }
      if (key.tab) {
        const next = nextMarketKind(kind);
        setKind(next); void search(query, next); return;
      }
      if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
      if (key.downArrow) return setTyping(false);
      if (input && !key.ctrl && !key.meta) return setQuery((q) => q + input);
      return;
    }
    if (input === "/") return setTyping(true);
    if (input === "a") { setStage("agents"); void loadAgents(); return; }
    if (input === "p") { setPubResult(null); setPubField("name"); setStage("publish"); return; }
    if (key.tab) {
      const next = nextMarketKind(kind);
      setKind(next); void search(query, next); return;
    }
    if (key.upArrow) { if (clamped === 0) return setTyping(true); return setIdx((i) => Math.max(0, i - 1)); }
    if (key.downArrow) return setIdx((i) => Math.min(results.length - 1, i + 1));
    if (key.return && selected) return void openDetail(selected.id);
    if (input === "b" && selected && selected.type !== "plugin" && !owned.has(selected.name)) { setDetail(null); setStage("confirm"); }
  });

  // ── agent profile ─────────────────────────────────────────────────────────
  if (stage === "agentProfile" && agentProfile) {
    const r = agentProfile.reputation;
    const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Box>
          <Text bold color={colors.iqCyan}>{short(r.wallet)}</Text>
          <Text dimColor>   {r.skillsPublished} skills · ×{r.totalSupply} total supply · {r.notesReceived} notes</Text>
        </Box>
        {agentProfile.createdSkills && agentProfile.createdSkills.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>skills:</Text>
            {agentProfile.createdSkills.slice(0, 8).map((s: any) => (
              <Box key={s.id}>
                <Text>  · </Text>
                <Text color={owned.has(s.name) ? colors.ok : undefined}>{s.name}</Text>
                {owned.has(s.name) ? <Text color={colors.ok}> owned</Text> : null}
              </Box>
            ))}
          </Box>
        ) : null}
        {agentProfile.notes.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>notes:</Text>
            {agentProfile.notes.slice(0, 4).map((n, i) => (
              <Text key={i} dimColor>  "{n.text.slice(0, 60)}"</Text>
            ))}
          </Box>
        ) : null}
        {agentBuyResult ? (
          <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {agentBuyResult}</Text></Box>
        ) : null}
        <Box marginTop={1}>
          <Text dimColor>[b] buy all skills · [esc] back</Text>
        </Box>
      </Box>
    );
  }

  // ── agents list ────────────────────────────────────────────────────────────
  if (stage === "agents") {
    const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ agent directory</Text>
        <Box flexDirection="column" marginTop={1}>
          {loading ? (
            <Text dimColor>loading agents…</Text>
          ) : error ? (
            <Text color={colors.err}>{error}</Text>
          ) : agents.length === 0 ? (
            <Text dimColor>no agents found</Text>
          ) : (
            agents.slice(0, 12).map((a, i) => {
              const on = i === agentIdx;
              return (
                <Box key={a.wallet}>
                  <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
                  <Box width={14}><Text dimColor>{short(a.wallet)}</Text></Box>
                  <Text dimColor>  ×{a.totalSupply} supply · {a.skillsPublished} skills</Text>
                </Box>
              );
            })
          )}
        </Box>
        <Box marginTop={1}><Text dimColor>↑/↓ move · ↵ profile · esc back</Text></Box>
      </Box>
    );
  }

  // ── publish form ──────────────────────────────────────────────────────────
  if (stage === "publish") {
    if (pubResult) {
      return (
        <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={pubResult.startsWith("published") ? colors.ok : colors.err}>
          <Text bold color={pubResult.startsWith("published") ? colors.ok : colors.err}>{pubResult}</Text>
          <Box marginTop={1}><Text dimColor>[esc] / [↵] close</Text></Box>
        </Box>
      );
    }
    const fieldLabels: Record<PublishField, string> = {
      name: "name      ", desc: "desc      ", text: "skill text",
      category: "category  ", hashtags: "hashtags  ", price: "price (SOL)",
    };
    const fieldValues: Record<PublishField, string> = {
      name: pubName, desc: pubDesc, text: pubText.slice(0, 60) + (pubText.length > 60 ? "…" : ""),
      category: pubCategory, hashtags: pubHashtags, price: pubPrice,
    };
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ publish skill</Text>
        <Box flexDirection="column" marginTop={1}>
          {PUBLISH_FIELDS.map((f) => {
            const on = f === pubField;
            return (
              <Box key={f}>
                <Text color={on ? colors.iqCyan : colors.dim}>{on ? "▸ " : "  "}</Text>
                <Box width={12}><Text color={on ? colors.iqCyan : colors.dim} bold={on}>{fieldLabels[f]}</Text></Box>
                <Text color={on ? undefined : colors.dim}>{fieldValues[f]}</Text>
                {on ? <Text inverse> </Text> : null}
              </Box>
            );
          })}
        </Box>
        {busy ? (
          <Box marginTop={1}>
            <Text dimColor>publishing…</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text dimColor>↑/↓/[tab] field · ↵ next / submit on price · esc cancel</Text>
        </Box>
        <Box><Text dimColor>hashtags = comma-separated · skill text = raw SKILL.md body</Text></Box>
      </Box>
    );
  }

  // ── comment ────────────────────────────────────────────────────────────────
  if (stage === "comment") {
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ post comment</Text>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={commentField === "text" ? colors.iqCyan : colors.dim}>{commentField === "text" ? "▸ " : "  "}</Text>
            <Box width={10}><Text color={commentField === "text" ? colors.iqCyan : colors.dim}>comment</Text></Box>
            <Text>{commentText}</Text>
            {commentField === "text" ? <Text inverse> </Text> : null}
          </Box>
          <Box>
            <Text color={commentField === "gitLink" ? colors.iqCyan : colors.dim}>{commentField === "gitLink" ? "▸ " : "  "}</Text>
            <Box width={10}><Text color={commentField === "gitLink" ? colors.iqCyan : colors.dim}>gitLink</Text></Box>
            <Text dimColor={!commentGitLink}>{commentGitLink || "(optional)"}</Text>
            {commentField === "gitLink" ? <Text inverse> </Text> : null}
          </Box>
        </Box>
        {flash ? <Box marginTop={1}><Text color={colors.ok}>{flash}</Text></Box> : null}
        {busy ? <Text dimColor>posting…</Text> : null}
        <Box marginTop={1}><Text dimColor>[tab] next field · ↵ post on gitLink field · esc cancel</Text></Box>
      </Box>
    );
  }

  // ── confirm ────────────────────────────────────────────────────────────────
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
          <Text color={colors.warn}>buy "{card?.name}"?  </Text>
          <Text dimColor>[y] yes · [n] no</Text>
        </Box>
      </Box>
    );
  }

  // ── detail ─────────────────────────────────────────────────────────────────
  if (stage === "detail" && detail) {
    const c = detail.card;
    const isOwned = owned.has(c.name);
    const isPlugin = c.type === "plugin";
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Box>
          <Text bold color={colors.iqCyan}>{c.name}</Text>
          <Text dimColor>  {c.type ?? "skill"} · ×{c.supply ?? 0}{isOwned ? " · owned" : ""}</Text>
        </Box>
        {c.description ? <Text>{c.description}</Text> : null}
        {isPlugin && c.engines?.length ? (
          <Box marginTop={1}><Text color={colors.iqCyan}>engines: {c.engines.join(", ")}</Text></Box>
        ) : null}
        {c.category || (c.hashtags && c.hashtags.length) ? (
          <Box marginTop={1}>
            {c.category ? <Text color={colors.iqViolet}>{c.category} </Text> : null}
            {(c.hashtags ?? []).map((h) => (
              <Text key={h} dimColor>#{h} </Text>
            ))}
          </Box>
        ) : null}
        {isPlugin ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>── plugin package ──</Text>
            {c.version ? <Text>version {c.version}</Text> : null}
            {c.iqGitPda ? <Text>IQ Git PDA {c.iqGitPda}</Text> : null}
            {c.capabilities?.length ? <Text>capabilities {c.capabilities.join(", ")}</Text> : null}
            {c.permissions?.length ? <Text>permissions {c.permissions.join(", ")}</Text> : null}
            <Text dimColor>install/equip is not wired yet</Text>
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
        {detail.skillText && !isPlugin ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>── SKILL.md ──</Text>
            <Text>{detail.skillText.slice(0, 1200)}</Text>
          </Box>
        ) : null}
        {detail.notes && detail.notes.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>── comments ({detail.notes.length}) ──</Text>
            {detail.notes.slice(0, 4).map((n, i) => (
              <Box key={i} flexDirection="column">
                <Text dimColor>  "{n.text.slice(0, 80)}"</Text>
                {n.gitLink ? <Text dimColor>    {glyph.sparkle} {n.gitLink}</Text> : null}
              </Box>
            ))}
          </Box>
        ) : null}
        {flash ? <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box> : null}
        <Box marginTop={1}>
          <Text dimColor>
            {isPlugin ? "plugin install/equip later · " : isOwned ? "owned · " : "[b] buy · "}[c] comment · [esc] back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── list ───────────────────────────────────────────────────────────────────
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
        <Text dimColor>  ·  </Text>
        <Text color={kind === "plugin" ? colors.iqCyan : colors.dim} bold={kind === "plugin"}>plugins</Text>
        <Text dimColor>  ·  </Text>
        <Text color={colors.dim}>[a] agents  [p] publish</Text>
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
          <Text dimColor>no {kind === "workflow" ? "workflows" : kind === "plugin" ? "plugins" : "skills"} found</Text>
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
                {c.type === "plugin" && c.engines?.length ? <Text color={colors.iqCyan}>{c.engines.join("+")} </Text> : null}
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
            ? "type to search · ↵ run · [tab] skills/workflows/plugins · ↓ results · esc close"
            : "↑/↓ move · ↵ open · [b] buy non-plugin · [tab] switch · [/] search · [a] agents · [p] publish · esc close"}
        </Text>
      </Box>
    </Box>
  );
}
