import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SkillCard, SkillDetail } from "@iqlabs-official/agent-sdk";
import type { Reputation, AgentProfile } from "@iqlabs-official/agent-sdk";
import { maskedHeliusKey, hasDasRpc, saveHeliusKey, getNetwork } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";
import { tierInfo } from "./market/tiers.js";
import { AgentProfileView, type ProfileSub } from "./market/AgentProfileView.js";
import { SkillDetailView, type DetailSub } from "./market/SkillDetailView.js";
import { HeliusPanel, HeliusBadge, type RpcStatusLite } from "./market/HeliusPanel.js";
import { PublishProgressView, type PublishProgress } from "./market/PublishProgressView.js";

export interface MarketApi {
  searchSkills(query: string, kind?: "skill" | "workflow", sort?: "supply" | "stars"): Promise<SkillCard[]>;
  getSkillDetail(mint: string): Promise<SkillDetail>;
  buySkill(skillId: string, creatorWallet?: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  solBalance(): Promise<number | null>;
  postNote(skillId: string, skillType: "skill" | "workflow" | undefined, text: string, gitLink?: string): Promise<{ ok: boolean; error?: string }>;
  publishSkill(
    input: { name: string; description: string; text: string; category?: string; hashtags?: string[]; priceSol: string; image?: string },
    onProgress?: (p: PublishProgress) => void,
  ): Promise<{ ok: boolean; mint?: string; error?: string }>;
  listAgents(): Promise<Reputation[]>;
  getAgentProfile(wallet: string): Promise<AgentProfile>;
  buyAllSkills(agentWallet: string): Promise<{ ok: boolean; bought: number; failed: number; error?: string }>;
  postAgentNote(agentWallet: string, text: string, gitLink?: string, title?: string, image?: string): Promise<{ ok: boolean; error?: string }>;
  disposeSkill(skillId: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  reEquipSkill(skillId: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  disposedSkillMints?(): Promise<Record<string, string>>;
  // name -> mint for the wallet's owned skills — used to resolve a workflow's required
  // skills (typed by name in the publish form) to the mints the on-chain gate needs.
  ownedSkillMints?(): Promise<Record<string, string>>;
}

type Stage =
  | "list"
  | "detail"
  | "confirm"
  | "comment"
  | "publish"
  | "agents"
  | "agentProfile"
  | "helius"
  | "blogCompose";

// Publish form fields in order — tab/arrow cycles through them.
type PublishField = "kind" | "name" | "desc" | "text" | "category" | "hashtags" | "price" | "image";
const PUBLISH_FIELDS: PublishField[] = ["kind", "name", "desc", "text", "category", "hashtags", "price", "image"];
// a workflow can require at most 16 skills (on-chain agent-workflow-nft contract limit)
const MAX_REQUIRED_SKILLS = 16;

type BlogField = "title" | "text" | "image" | "gitLink";
const BLOG_FIELDS: BlogField[] = ["title", "text", "image", "gitLink"];

const SOL = 1_000_000_000;
function sol(lamports: number | null): string {
  return lamports == null ? "—" : `${(lamports / SOL).toFixed(3)} SOL`;
}

function clampScroll(offset: number, total: number, height: number): number {
  const max = Math.max(0, total - height);
  return Math.max(0, Math.min(max, offset));
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
  const [kind, setKind] = useState<"skill" | "workflow">("skill");
  const [marketSort, setMarketSort] = useState<"supply" | "stars">("supply"); // GH #89 ranking
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
  const [hideOwned, setHideOwned] = useState(true);
  const [firingIds, setFiringIds] = useState<Set<string>>(new Set());
  const [disposedNames, setDisposedNames] = useState<Set<string>>(new Set());

  // detail sub-views (SKILL.md / comments scroll panels)
  const [detailSub, setDetailSub] = useState<DetailSub>("main");
  const [detailScroll, setDetailScroll] = useState(0);

  // comment stage
  const [commentText, setCommentText] = useState("");
  const [commentGitLink, setCommentGitLink] = useState("");
  const [commentField, setCommentField] = useState<"text" | "gitLink">("text");

  // publish stage
  const [pubField, setPubField] = useState<PublishField>("kind");
  const [pubKind, setPubKind] = useState<"skill" | "workflow">("skill");
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubText, setPubText] = useState("");
  const [pubCategory, setPubCategory] = useState("");
  const [pubHashtags, setPubHashtags] = useState("");
  const [pubPrice, setPubPrice] = useState("0.1");
  const [pubImage, setPubImage] = useState("");
  const [pubResult, setPubResult] = useState<string | null>(null);
  const [pubProgress, setPubProgress] = useState<PublishProgress | null>(null);

  // agents stage
  const [agents, setAgents] = useState<Reputation[]>([]);
  const [agentIdx, setAgentIdx] = useState(0);
  const [agentQuery, setAgentQuery] = useState("");
  const [agentTyping, setAgentTyping] = useState(false);
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
  const [agentBuyResult, setAgentBuyResult] = useState<string | null>(null);
  const [profileSub, setProfileSub] = useState<ProfileSub>("main");
  const [profileScroll, setProfileScroll] = useState(0);

  // blog composer (self note on own profile)
  const [blogField, setBlogField] = useState<BlogField>("title");
  const [blogTitle, setBlogTitle] = useState("");
  const [blogText, setBlogText] = useState("");
  const [blogImage, setBlogImage] = useState("");
  const [blogGitLink, setBlogGitLink] = useState("");

  // helius / RPC settings
  const [rpcStatus, setRpcStatus] = useState<RpcStatusLite | null>(null);
  const [heliusKeyInput, setHeliusKeyInput] = useState("");
  const [heliusFlash, setHeliusFlash] = useState<string | null>(null);

  const owned = new Set(ownedNames);
  const clamped = Math.min(idx, Math.max(0, results.length - 1));
  const visibleResults = results.filter((c) => !hideOwned || !owned.has(c.name));
  const selected = results[clamped];

  async function search(q: string, k: "skill" | "workflow", sort: "supply" | "stars" = marketSort) {
    setLoading(true);
    setError(null);
    try {
      setResults(await api.searchSkills(q, k, sort));
      setIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshRpcStatus() {
    const [masked, hasKey, network] = await Promise.all([
      maskedHeliusKey().catch(() => null),
      hasDasRpc().catch(() => false),
      Promise.resolve(getNetwork()),
    ]);
    setRpcStatus({ hasKey: !!masked, masked, network });
  }

  useEffect(() => {
    void search("", kind);
    void api.solBalance().then(setBalance).catch(() => setBalance(null));
    void refreshRpcStatus();
    void api.disposedSkillMints?.().then((m) => setDisposedNames(new Set(Object.keys(m)))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fire(id: string) {
    setFiringIds((s) => new Set(s).add(id));
    setTimeout(() => setFiringIds((s) => { const n = new Set(s); n.delete(id); return n; }), 1500);
  }

  async function openDetail(mint: string) {
    setLoading(true);
    try {
      setDetail(await api.getSkillDetail(mint));
      setDetailSub("main");
      setDetailScroll(0);
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
      fire(card.id);
      onBought();
      void api.solBalance().then(setBalance).catch(() => {});
      setStage("list");
      setDetail(null);
    } else {
      setFlash(`buy failed: ${res.error ?? "unknown error"}`);
      setStage("detail");
    }
  }

  async function doCollectAll() {
    if (!detail) return;
    const unownedRequired = detail.requiredCards.filter((r) => !owned.has(r.name));
    if (unownedRequired.length === 0) return;
    setBusy(true);
    let bought = 0, failed = 0;
    for (const r of unownedRequired) {
      const res = await api.buySkill(r.id, r.creator);
      if (res.ok) { bought++; fire(r.id); } else failed++;
    }
    setBusy(false);
    setFlash(`collected ${bought} skill${bought !== 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}`);
    if (bought > 0) { onBought(); void api.solBalance().then(setBalance).catch(() => {}); }
  }

  async function doDispose() {
    if (!detail) return;
    setBusy(true);
    const res = await api.disposeSkill(detail.card.id);
    setBusy(false);
    if (res.ok) {
      setFlash(`disposed ${detail.card.name}`);
      setDisposedNames((s) => new Set(s).add(detail.card.name));
      onBought();
    } else {
      setFlash(`dispose failed: ${res.error ?? "unknown"}`);
    }
  }

  async function doReEquip() {
    if (!detail) return;
    setBusy(true);
    const res = await api.reEquipSkill(detail.card.id);
    setBusy(false);
    if (res.ok) {
      setFlash(`re-equipped ${detail.card.name}`);
      fire(detail.card.id);
      setDisposedNames((s) => { const n = new Set(s); n.delete(detail.card.name); return n; });
      onBought();
    } else {
      setFlash(`re-equip failed: ${res.error ?? "unknown"}`);
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
    if (!pubName.trim() || !pubDesc.trim()) return;
    if (pubKind === "skill" && !pubText.trim()) return;
    setBusy(true);
    setPubProgress(null);

    let text = pubText.trim();
    if (pubKind === "workflow") {
      const names = pubText.split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length === 0) { setBusy(false); setPubResult("failed: pick at least one required skill"); return; }
      if (names.length > MAX_REQUIRED_SKILLS) { setBusy(false); setPubResult(`failed: max ${MAX_REQUIRED_SKILLS} required skills`); return; }
      const owned = (await api.ownedSkillMints?.()) ?? {};
      const missing = names.filter((n) => !owned[n]);
      if (missing.length) { setBusy(false); setPubResult(`failed: not owned — ${missing.join(", ")}`); return; }
      // Synthesize SKILL.md frontmatter (type: workflow + requiredSkills) — the backend
      // mints it as a workflow by sniffing this out of `text` (env.ts publishFrontmatter).
      text = [
        "---",
        `name: ${pubName.trim()}`,
        `description: ${pubDesc.trim().replace(/\s*\n\s*/g, " ")}`,
        "type: workflow",
        `requiredSkills: [${names.map((n) => owned[n]).join(", ")}]`,
        "---",
        "",
        `# ${pubName.trim()}`,
        "",
        pubDesc.trim(),
        "",
      ].join("\n");
    }

    const res = await api.publishSkill(
      {
        name: pubName.trim(),
        description: pubDesc.trim(),
        text,
        category: pubCategory.trim() || undefined,
        hashtags: pubHashtags.trim() ? pubHashtags.split(",").map((h) => h.trim()).filter(Boolean) : undefined,
        priceSol: pubPrice.trim() || "0.1",
        image: pubImage.trim() || undefined,
      },
      (p) => setPubProgress(p),
    );
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
      setAgentQuery("");
      setAgentTyping(false);
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
      setProfileSub("main");
      setProfileScroll(0);
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

  async function doPostBlog() {
    if (!agentProfile || !blogText.trim()) return;
    setBusy(true);
    const res = await api.postAgentNote(
      agentProfile.wallet,
      blogText.trim(),
      blogGitLink.trim() || undefined,
      blogTitle.trim() || undefined,
      blogImage.trim() || undefined,
    );
    setBusy(false);
    if (res.ok) {
      setBlogTitle(""); setBlogText(""); setBlogImage(""); setBlogGitLink("");
      const refreshed = await api.getAgentProfile(agentProfile.wallet).catch(() => null);
      if (refreshed) setAgentProfile(refreshed);
      setProfileSub("blog");
      setStage("agentProfile");
    } else {
      setFlash(`post failed: ${res.error ?? "unknown"}`);
    }
  }

  async function doSaveHeliusKey(key: string) {
    setBusy(true);
    await saveHeliusKey(key);
    await refreshRpcStatus();
    setBusy(false);
    setHeliusKeyInput("");
    setHeliusFlash(key ? "key saved" : "key cleared");
  }

  // get/set helpers for publish form fields
  function pubGet(f: Exclude<PublishField, "kind">) {
    return { name: pubName, desc: pubDesc, text: pubText, category: pubCategory, hashtags: pubHashtags, price: pubPrice, image: pubImage }[f];
  }
  function pubSet(f: Exclude<PublishField, "kind">, v: string) {
    ({ name: setPubName, desc: setPubDesc, text: setPubText, category: setPubCategory, hashtags: setPubHashtags, price: setPubPrice, image: setPubImage }[f])(v);
  }

  function blogGet(f: BlogField) {
    return { title: blogTitle, text: blogText, image: blogImage, gitLink: blogGitLink }[f];
  }
  function blogSet(f: BlogField, v: string) {
    ({ title: setBlogTitle, text: setBlogText, image: setBlogImage, gitLink: setBlogGitLink }[f])(v);
  }

  useInput((input, key) => {
    if (busy) return;

    // ── helius settings ───────────────────────────────────────────────────
    if (stage === "helius") {
      if (key.escape) { setStage("list"); setHeliusFlash(null); return; }
      if (input === "x" && !heliusKeyInput) { void doSaveHeliusKey(""); return; }
      if (key.return) { void doSaveHeliusKey(heliusKeyInput.trim()); return; }
      if (key.backspace || key.delete) { setHeliusKeyInput((v) => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setHeliusKeyInput((v) => v + input); return; }
      return;
    }

    // ── blog composer (self) ──────────────────────────────────────────────
    if (stage === "blogCompose") {
      if (key.escape) { setStage("agentProfile"); setProfileSub("blog"); return; }
      const fi = BLOG_FIELDS.indexOf(blogField);
      if (key.tab || key.downArrow) { setBlogField(BLOG_FIELDS[(fi + 1) % BLOG_FIELDS.length]); return; }
      if (key.upArrow) { setBlogField(BLOG_FIELDS[(fi + BLOG_FIELDS.length - 1) % BLOG_FIELDS.length]); return; }
      if (key.return) {
        if (fi < BLOG_FIELDS.length - 1) setBlogField(BLOG_FIELDS[fi + 1]);
        else void doPostBlog();
        return;
      }
      if (key.backspace || key.delete) { blogSet(blogField, blogGet(blogField).slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { blogSet(blogField, blogGet(blogField) + input); return; }
      return;
    }

    // ── agent profile ──────────────────────────────────────────────────────
    if (stage === "agentProfile") {
      const total =
        profileSub === "repos" ? (agentProfile?.verifiedRepos ?? []).length :
        profileSub === "comments" ? (agentProfile?.threads ?? []).filter((t) => !t.note.isSelfNote).reduce((s, t) => s + 1 + t.replies.length, 0) :
        profileSub === "blog" ? (agentProfile?.threads ?? []).filter((t) => t.note.isSelfNote).length : 0;
      const height = profileSub === "repos" ? 10 : 12;
      if (profileSub !== "main") {
        if (key.escape) { setProfileSub("main"); setProfileScroll(0); return; }
        if (key.downArrow) { setProfileScroll((o) => clampScroll(o + 1, total, height)); return; }
        if (key.upArrow) { setProfileScroll((o) => clampScroll(o - 1, total, height)); return; }
        if (key.pageDown) { setProfileScroll((o) => clampScroll(o + height, total, height)); return; }
        if (key.pageUp) { setProfileScroll((o) => clampScroll(o - height, total, height)); return; }
        if (profileSub === "blog" && input === "n" && agentProfile?.self) {
          setBlogField("title"); setStage("blogCompose"); return;
        }
        return;
      }
      if (key.escape) { setStage("agents"); setAgentProfile(null); setAgentBuyResult(null); return; }
      if (input === "r") { setProfileSub("repos"); setProfileScroll(0); return; }
      if (input === "k") { setProfileSub("comments"); setProfileScroll(0); return; }
      if (input === "g") { setProfileSub("blog"); setProfileScroll(0); return; }
      if (input === "n" && agentProfile?.self) { setBlogField("title"); setStage("blogCompose"); return; }
      if (input === "b" && agentProfile) void doBuyAll(agentProfile.reputation.wallet);
      return;
    }

    // ── agents list ────────────────────────────────────────────────────────
    if (stage === "agents") {
      const filtered = agents.filter((a) => !agentQuery.trim() || a.wallet.toLowerCase().includes(agentQuery.toLowerCase()));
      if (agentTyping) {
        if (key.return || key.downArrow) { setAgentTyping(false); setAgentIdx(0); return; }
        if (key.backspace || key.delete) { setAgentQuery((q) => q.slice(0, -1)); return; }
        if (key.escape) { setStage("list"); setAgents([]); setError(null); return; }
        if (input && !key.ctrl && !key.meta) { setAgentQuery((q) => q + input); return; }
        return;
      }
      if (key.escape) { setStage("list"); setAgents([]); setError(null); return; }
      if (input === "/") { setAgentTyping(true); return; }
      if (key.upArrow) { if (agentIdx === 0) { setAgentTyping(true); return; } return setAgentIdx((i) => Math.max(0, i - 1)); }
      if (key.downArrow) return setAgentIdx((i) => Math.min(filtered.length - 1, i + 1));
      if (key.return && filtered[agentIdx]) void openAgentProfile(filtered[agentIdx].wallet);
      return;
    }

    // ── publish ────────────────────────────────────────────────────────────
    if (stage === "publish") {
      if (pubResult) {
        if (key.escape || key.return) { setPubResult(null); setPubProgress(null); setStage("list"); }
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
      if (pubField === "kind" && (key.leftArrow || key.rightArrow || input === " ")) {
        setPubKind((k) => (k === "skill" ? "workflow" : "skill"));
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
      if (pubField === "kind") return; // toggle-only field, no free text
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
    if (stage === "detail" && detail) {
      const isOwned = owned.has(detail.card.name);
      const disposed = disposedNames.has(detail.card.name);
      if (detailSub !== "main") {
        const total = detailSub === "skillText" ? (detail.skillText ?? "").split("\n").length : (detail.notes ?? []).length;
        const height = detailSub === "skillText" ? 16 : 12;
        if (key.escape) { setDetailSub("main"); setDetailScroll(0); return; }
        if (key.downArrow) { setDetailScroll((o) => clampScroll(o + 1, total, height)); return; }
        if (key.upArrow) { setDetailScroll((o) => clampScroll(o - 1, total, height)); return; }
        if (key.pageDown) { setDetailScroll((o) => clampScroll(o + height, total, height)); return; }
        if (key.pageUp) { setDetailScroll((o) => clampScroll(o - height, total, height)); return; }
        return;
      }
      if (key.escape) { setStage("list"); setDetail(null); return; }
      if (input === "b" && !isOwned) { setStage("confirm"); return; }
      if (input === "c") {
        setCommentText(""); setCommentGitLink(""); setCommentField("text");
        setStage("comment");
        return;
      }
      if (input === "v" && detail.skillText) { setDetailSub("skillText"); setDetailScroll(0); return; }
      if (input === "k") { setDetailSub("comments"); setDetailScroll(0); return; }
      if (input === "d" && isOwned && !disposed) { void doDispose(); return; }
      if (input === "e" && isOwned && disposed) { void doReEquip(); return; }
      if (input === "x" && detail.requiredCards.some((r) => !owned.has(r.name))) { void doCollectAll(); return; }
      return;
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (key.escape) return onClose();
    if (typing) {
      if (key.return) { setTyping(false); void search(query, kind); return; }
      if (key.tab) {
        const next = kind === "skill" ? "workflow" : "skill";
        setKind(next); void search(query, next); return;
      }
      if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
      if (key.downArrow) return setTyping(false);
      if (input && !key.ctrl && !key.meta) return setQuery((q) => q + input);
      return;
    }
    if (input === "/") return setTyping(true);
    if (input === "a") { setStage("agents"); void loadAgents(); return; }
    if (input === "p") { setPubResult(null); setPubProgress(null); setPubField("kind"); setPubKind("skill"); setStage("publish"); return; }
    if (input === "r") { setHeliusFlash(null); setHeliusKeyInput(""); setStage("helius"); return; }
    if (input === "h") { setHideOwned((v) => !v); setIdx(0); return; }
    if (input === "s") { const next = marketSort === "stars" ? "supply" : "stars"; setMarketSort(next); void search(query, kind, next); return; }
    if (key.tab) {
      const next = kind === "skill" ? "workflow" : "skill";
      setKind(next); void search(query, next); return;
    }
    if (key.upArrow) { if (clamped === 0) return setTyping(true); return setIdx((i) => Math.max(0, i - 1)); }
    if (key.downArrow) return setIdx((i) => Math.min(visibleResults.length - 1, i + 1));
    if (key.return && selected) return void openDetail(selected.id);
    if (input === "b" && selected && !owned.has(selected.name)) { setDetail(null); setStage("confirm"); }
  });

  // ── helius settings ─────────────────────────────────────────────────────────
  if (stage === "helius") {
    return <HeliusPanel status={rpcStatus} keyInput={heliusKeyInput} busy={busy} flash={heliusFlash} />;
  }

  // ── blog composer ─────────────────────────────────────────────────────────
  if (stage === "blogCompose") {
    const labels: Record<BlogField, string> = { title: "title   ", text: "text    ", image: "image   ", gitLink: "gitLink " };
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ write a blog post</Text>
        <Box flexDirection="column" marginTop={1}>
          {BLOG_FIELDS.map((f) => {
            const on = f === blogField;
            const val = blogGet(f);
            return (
              <Box key={f}>
                <Text color={on ? colors.iqCyan : colors.dim}>{on ? "▸ " : "  "}</Text>
                <Box width={10}><Text color={on ? colors.iqCyan : colors.dim} bold={on}>{labels[f]}</Text></Box>
                <Text dimColor={!val && f !== "title" && f !== "text"}>{val || (f === "title" || f === "text" ? "" : "(optional)")}</Text>
                {on ? <Text inverse> </Text> : null}
              </Box>
            );
          })}
        </Box>
        {busy ? <Box marginTop={1}><Text dimColor>posting…</Text></Box> : null}
        <Box marginTop={1}><Text dimColor>↑/↓/[tab] field · ↵ next / post on gitLink · esc cancel</Text></Box>
      </Box>
    );
  }

  // ── agent profile ─────────────────────────────────────────────────────────
  if (stage === "agentProfile" && agentProfile) {
    return (
      <AgentProfileView
        profile={agentProfile}
        owned={owned}
        buyAllResult={agentBuyResult}
        busy={busy}
        sub={profileSub}
        scrollOffset={profileScroll}
        self={agentProfile.self}
      />
    );
  }

  // ── agents list ────────────────────────────────────────────────────────────
  if (stage === "agents") {
    const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
    const filtered = agents.filter((a) => !agentQuery.trim() || a.wallet.toLowerCase().includes(agentQuery.toLowerCase()));
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ agent directory</Text>
        <Box marginTop={1}>
          <Text color={agentTyping ? colors.iqCyan : colors.dim}>{agentTyping ? "▸ " : "  "}</Text>
          <Text dimColor>search wallet </Text>
          <Text>{agentQuery}</Text>
          {agentTyping ? <Text inverse> </Text> : null}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {loading ? (
            <Text dimColor>loading agents…</Text>
          ) : error ? (
            <Text color={colors.err}>{error}</Text>
          ) : filtered.length === 0 ? (
            <Text dimColor>no agents found</Text>
          ) : (
            filtered.slice(0, 12).map((a, i) => {
              const on = !agentTyping && i === agentIdx;
              const { cur } = tierInfo(a.stars ?? 0);
              return (
                <Box key={a.wallet}>
                  <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
                  <Box width={14}><Text dimColor>{short(a.wallet)}</Text></Box>
                  <Text dimColor>  ×{a.totalSupply} supply · {a.skillsPublished} skills</Text>
                  {cur ? <Text color={colors.warn}> [{cur.name}]</Text> : null}
                </Box>
              );
            })
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{agentTyping ? "type to filter · ↵/↓ browse · esc close" : "↑/↓ move · ↵ profile · [/] search · esc back"}</Text>
        </Box>
      </Box>
    );
  }

  // ── publish form ──────────────────────────────────────────────────────────
  if (stage === "publish") {
    if (pubResult) {
      const ok = pubResult.startsWith("published");
      return (
        <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={ok ? colors.ok : colors.err}>
          <Text bold color={ok ? colors.ok : colors.err}>{pubResult}</Text>
          <Box marginTop={1}><Text dimColor>[esc] / [↵] close</Text></Box>
        </Box>
      );
    }
    const fieldLabels: Record<PublishField, string> = {
      kind: "type      ", name: "name      ", desc: "desc      ",
      text: pubKind === "workflow" ? "req skills" : "skill text",
      category: "category  ", hashtags: "hashtags  ", price: "price (SOL)", image: "image     ",
    };
    const fieldValues: Record<PublishField, string> = {
      kind: pubKind, name: pubName, desc: pubDesc, text: pubText.slice(0, 60) + (pubText.length > 60 ? "…" : ""),
      category: pubCategory, hashtags: pubHashtags, price: pubPrice, image: pubImage,
    };
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ publish {pubKind}</Text>
        <Box flexDirection="column" marginTop={1}>
          {PUBLISH_FIELDS.map((f) => {
            const on = f === pubField;
            return (
              <Box key={f}>
                <Text color={on ? colors.iqCyan : colors.dim}>{on ? "▸ " : "  "}</Text>
                <Box width={12}><Text color={on ? colors.iqCyan : colors.dim} bold={on}>{fieldLabels[f]}</Text></Box>
                <Text color={on ? undefined : colors.dim}>{fieldValues[f]}</Text>
                {on && f !== "kind" ? <Text inverse> </Text> : null}
              </Box>
            );
          })}
        </Box>
        {busy ? <PublishProgressView progress={pubProgress} /> : null}
        <Box marginTop={1}>
          <Text dimColor>
            {pubField === "kind" ? "←/→/[space] toggle · " : ""}↑/↓/[tab] field · ↵ next / submit on image · esc cancel
          </Text>
        </Box>
        <Box><Text dimColor>hashtags = comma-separated · image = link or on-chain ref, optional</Text></Box>
        {pubKind === "workflow" ? (
          <Box><Text dimColor>req skills = comma-separated names you own (max {MAX_REQUIRED_SKILLS})</Text></Box>
        ) : null}
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
    const isOwned = owned.has(detail.card.name);
    const disposed = disposedNames.has(detail.card.name);
    return (
      <SkillDetailView
        detail={detail}
        owned={owned}
        disposed={disposed}
        isOwned={isOwned}
        sub={detailSub}
        scrollOffset={detailScroll}
        firing={firingIds.has(detail.card.id)}
        flash={flash}
        busy={busy}
      />
    );
  }

  // ── list ───────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box>
        <Text bold color={colors.iqMagenta}>❖ skill market</Text>
        <Text dimColor>   balance {sol(balance)}</Text>
        <Text dimColor>   </Text>
        <HeliusBadge status={rpcStatus} />
      </Box>
      {/* tabs */}
      <Box marginTop={1}>
        <Text color={kind === "skill" ? colors.iqCyan : colors.dim} bold={kind === "skill"}>skills</Text>
        <Text dimColor>  ·  </Text>
        <Text color={kind === "workflow" ? colors.iqCyan : colors.dim} bold={kind === "workflow"}>workflows</Text>
        <Text dimColor>  ·  </Text>
        <Text color={colors.dim}>[a] agents  [p] publish  [r] rpc</Text>
      </Box>
      {/* search box + hide-owned filter */}
      <Box marginTop={1}>
        <Text color={typing ? colors.iqCyan : colors.dim}>{typing ? "▸ " : "  "}</Text>
        <Text dimColor>search </Text>
        <Text>{query}</Text>
        {typing ? <Text inverse> </Text> : null}
        <Text dimColor>   [h] hide owned </Text>
        <Text color={hideOwned ? colors.ok : colors.dim}>{hideOwned ? "✓" : "✗"}</Text>
        <Text dimColor>   [s] sort </Text>
        <Text color={marketSort === "stars" ? colors.warn : colors.dim}>{marketSort === "stars" ? "★ stars" : "popular"}</Text>
      </Box>
      {/* results */}
      <Box flexDirection="column" marginTop={1}>
        {loading ? (
          <Text dimColor>searching…</Text>
        ) : error ? (
          <Text color={colors.err}>{error}</Text>
        ) : visibleResults.length === 0 ? (
          <Text dimColor>no {kind === "skill" ? "skills" : "workflows"} found</Text>
        ) : (
          visibleResults.slice(0, 12).map((c, i) => {
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
                {c.stars ? <Text color={colors.warn}>★{c.stars} </Text> : null}
                {isOwned ? <Text color={colors.ok}>owned{firingIds.has(c.id) ? " ✦" : ""} </Text> : null}
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
            : "↑/↓ move · ↵ open · [b] buy · [tab] switch · [/] search · [a] agents · [p] publish · [r] rpc · [h] hide owned · [s] sort · esc close"}
        </Text>
      </Box>
    </Box>
  );
}
