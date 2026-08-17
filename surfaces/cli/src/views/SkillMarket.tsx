import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { SkillCard, SkillDetail } from "@iqlabs-official/agent-sdk";
import type { Reputation, AgentProfile } from "@iqlabs-official/agent-sdk";
import { maskedHeliusKey, hasDasRpc, saveHeliusKey, getNetwork } from "@iqlabs-official/agent-sdk";
import { saveGithubToken, loadGithubToken, maskedGithubToken, registerVerifiedWork, parseGithubRepo } from "@iqlabs-official/agent-sdk";
import { colors, glyph, tierColor, tierColors } from "../theme.js";
import { displayWidth, truncateEnd, truncateStart } from "../format.js";
import type { OwnedSkill } from "../components/WelcomePanel.js";
import { ChipCarousel } from "../components/ChipCarousel.js";
import { Band } from "../components/Band.js";
import { tierInfo, TierGauge } from "./market/tiers.js";
import { walletColor, walletFace } from "./market/avatar.js";
import { AgentProfileView, type ProfileSub } from "./market/AgentProfileView.js";
import { SkillDetailView, mainLines, mainViewportH, skillTextLines, commentLines, subViewportH, type DetailSub } from "./market/SkillDetailView.js";
import { HeliusPanel, HeliusBadge, heliusBadgeText, type RpcStatusLite } from "./market/HeliusPanel.js";
import { GithubPanel, githubRowAt, githubRowCount, type GithubStatusLite } from "./market/GithubPanel.js";
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
  | "github"
  | "blogCompose"
  | "owned";

// Publish form fields in order — tab/arrow cycles through them.
type PublishField = "kind" | "name" | "desc" | "text" | "category" | "hashtags" | "price" | "image";
const PUBLISH_FIELDS: PublishField[] = ["kind", "name", "desc", "text", "category", "hashtags", "price", "image"];
// a workflow can require at most 16 skills (on-chain agent-workflow-nft contract limit)
const MAX_REQUIRED_SKILLS = 16;

type BlogField = "title" | "text" | "image" | "gitLink";
const BLOG_FIELDS: BlogField[] = ["title", "text", "image", "gitLink"];

const SOL = 1_000_000_000;
function sol(lamports: number | null): string {
  return lamports == null ? "-" : `${(lamports / SOL).toFixed(3)} SOL`;
}

function clampScroll(offset: number, total: number, height: number): number {
  const max = Math.max(0, total - height);
  return Math.max(0, Math.min(max, offset));
}

const SKILL_CHIP_W = 26;

// a skill as a compact "SD-card" chip - mark, name, grade, supply, price, state. The CLI
// cousin of surfaces/webview SkillSdCard, reimplemented in ink boxes (that one is DOM).
function SkillChip({
  card,
  focused,
  isOwned,
  firing,
}: {
  card: SkillCard;
  focused: boolean;
  isOwned: boolean;
  firing: boolean;
}) {
  const isWorkflow = card.type === "workflow";
  const cat = (card.category || (isWorkflow ? "workflow" : "skill")).toUpperCase().slice(0, 8);
  const price = card.price && card.price !== "0" ? sol(Number(card.price)) : "FREE";
  const { cur } = tierInfo(card.stars ?? 0);
  // design tab 08: grey silhouette = skill, gold = workflow; the selected card lights up.
  const accent = isWorkflow ? colors.warn : colors.dim;
  return (
    <Box
      flexDirection="column"
      width={SKILL_CHIP_W}
      paddingX={1}
      borderStyle="round"
      borderColor={focused ? colors.iqCyan : accent}
    >
      {/* barcode glyph + category/type mark, the card's top strip. truncate, never
          wrap: when a narrow terminal squeezes the fixed-width chip, a wrapped strip
          would grow the card a row and push the whole list frame past the screen. */}
      <Box justifyContent="space-between">
        <Text color={accent} wrap="truncate-end">▐▖▐</Text>
        <Text dimColor wrap="truncate-end">{cat} / {isWorkflow ? "FLOW" : "SKILL"}</Text>
      </Box>
      <Text color={focused ? colors.iqCyan : colors.bone} bold wrap="truncate-end">
        {card.name.slice(0, SKILL_CHIP_W - 4)}
      </Text>
      {/* the big supply number, like the design's card corner count */}
      <Box justifyContent="space-between">
        <Text bold color={colors.bone}>×{card.supply ?? 0}</Text>
        {/* the grade wears its metal (tierColor), and the ★ count rides the same tint:
            amber here made a Bronze chip indistinguishable from a Gold one. */}
        <Text>
          {card.stars ? <Text color={tierColor(cur?.name)}>★{card.stars} </Text> : null}
          {cur ? <Text color={tierColor(cur.name)}>[{cur.name}]</Text> : null}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={colors.iqViolet}>{price}</Text>
        <Text color={isOwned ? colors.ok : colors.dim} bold={isOwned}>
          {isOwned ? `OWNED${firing ? ` ${glyph.sparkle}` : ""}` : "GET"}
        </Text>
      </Box>
    </Box>
  );
}

export function SkillMarket({
  api,
  walletAddr,
  ownedNames,
  onBought,
  onClose,
  initialStage,
  owned: ownedCollection = [],
}: {
  api: MarketApi;
  walletAddr: string;
  ownedNames: string[];
  onBought: () => void;
  onClose: () => void;
  initialStage?: "list" | "agents" | "owned" | "github";
  // null = the host is still fetching the wallet's skills (the WelcomePanel convention:
  // skills === null means loading, [] means fetched and none owned). The owned stage and
  // the github panel read the difference so neither claims "no skills" mid-fetch.
  owned?: OwnedSkill[] | null;
}) {
  const [stage, setStage] = useState<Stage>(initialStage ?? "list");
  // Esc unwinds to where the user actually came from. /github, /agents and /skills
  // open the market already jumped to an inner stage, so the user arrived from CHAT
  // and never saw the list; esc on that entry stage closes the market (onClose)
  // instead of stranding them on the list. Entered from the list ([g], [a]), the
  // same esc returns to the list exactly as before. Deeper stages are untouched.
  const entryStage: Stage = initialStage ?? "list";
  function backOut(from: Stage) {
    if (from === entryStage) onClose();
    else setStage("list");
  }
  const [kind, setKind] = useState<"skill" | "workflow">("skill");
  const [marketSort, setMarketSort] = useState<"supply" | "stars">("supply"); // GH #89 ranking
  const [query, setQuery] = useState("");
  // the list owns first focus: a fresh user's first keystroke means a command ([h], [a],
  // [p], [b]...), matching the footer. Auto-focusing the search box swallowed it as
  // query text instead. "/" or the up arrow still moves focus into the search box.
  const [typing, setTyping] = useState(false);
  // null = no search has settled yet (the WelcomePanel null-means-loading convention).
  // The first frame renders before the mount effect fires its search; with [] here that
  // frame claimed "no skills found" and "0 ON MAINNET" for a fetch that had not begun.
  const [results, setResults] = useState<SkillCard[] | null>(null);
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

  // owned collection stage
  const [ownedIdx, setOwnedIdx] = useState(0);

  // agents stage. null = the directory fetch has not settled (same null convention as
  // results): /agents renders one frame before the mount effect calls loadAgents, and
  // with [] that frame said "no agents found" while the fetch was still ahead of it.
  const [agents, setAgents] = useState<Reputation[] | null>(null);
  const [agentIdx, setAgentIdx] = useState(0);
  const [agentQuery, setAgentQuery] = useState("");
  const [agentTyping, setAgentTyping] = useState(false);
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
  const [agentBuyResult, setAgentBuyResult] = useState<string | null>(null);
  const [profileSub, setProfileSub] = useState<ProfileSub>("main");
  const [profileScroll, setProfileScroll] = useState(0);

  // note composer — reused for a self blog post AND a comment on another agent (both are
  // postAgentNote to the profile's wallet; only the gate and the landing sub differ).
  const [composeKind, setComposeKind] = useState<"blog" | "comment">("blog");
  const [blogField, setBlogField] = useState<BlogField>("title");
  const [blogTitle, setBlogTitle] = useState("");
  const [blogText, setBlogText] = useState("");
  const [blogImage, setBlogImage] = useState("");
  const [blogGitLink, setBlogGitLink] = useState("");

  // helius / RPC settings
  const [rpcStatus, setRpcStatus] = useState<RpcStatusLite | null>(null);
  const [heliusKeyInput, setHeliusKeyInput] = useState("");
  const [heliusFlash, setHeliusFlash] = useState<string | null>(null);

  // github verified-work screen: token connect + register-repo. Mirrors the helius
  // screen's shape (status + one flash), plus the register form's repo/skill picker.
  const [githubStatus, setGithubStatus] = useState<GithubStatusLite | null>(null);
  const [ghTokenInput, setGhTokenInput] = useState("");
  const [ghRepoInput, setGhRepoInput] = useState("");
  const [ghSelected, setGhSelected] = useState<Record<string, boolean>>({}); // mint -> chosen
  // ONE vertical focus list (order in githubRowAt): token, repo, each skill, register.
  const [ghFocusIdx, setGhFocusIdx] = useState(0);
  const [ghTokenEditing, setGhTokenEditing] = useState(false); // replacing a stored token
  const [ghFlash, setGhFlash] = useState<string | null>(null);

  const owned = new Set(ownedNames);
  // the mechanical views of the two nullable lists: mechanics (row math, selection,
  // filters) treat pending as empty; only the render tells the two apart.
  const ownedList = ownedCollection ?? [];
  const ownedLoading = ownedCollection === null;
  const marketStdout = useStdout().stdout; // || not ??: detached pty reports 0 rows/cols
  const agentRows = marketStdout?.rows || 24;
  const marketCols = marketStdout?.columns || 80;
  const visibleResults = (results ?? []).filter((c) => !hideOwned || !owned.has(c.name));
  // index over the FILTERED list - what's on screen is what enter/buy act on
  const clamped = Math.min(idx, Math.max(0, visibleResults.length - 1));
  const selected = visibleResults[clamped];

  // The one reason /github register can't fire yet, in the order the form is filled
  // (mirrors the app's RegisterWorkRepo blockReason). Reuses core parseGithubRepo for
  // the client-side validity check so a bad repo is caught before any network call.
  // Single source: both the github useInput gate and GithubPanel read this.
  const ghChosen = Object.keys(ghSelected).filter((m) => ghSelected[m]);
  const ghParsedRepo = parseGithubRepo(ghRepoInput);
  const githubBlockReason: string | null =
    !githubStatus?.hasToken ? "add a GitHub token above first."
    : ghRepoInput.trim().length === 0 ? "enter a repo first: owner/name or a github.com URL."
    : ghParsedRepo == null ? "that repo is not valid. use owner/name or a github.com URL."
    : ownedLoading ? "loading your skills…"
    : ownedList.length === 0 ? "buy or mint a skill first, then link it here."
    : ghChosen.length === 0 ? "pick at least one skill this repo used."
    : null;

  async function search(q: string, k: "skill" | "workflow", sort: "supply" | "stars" = marketSort) {
    setLoading(true);
    setError(null);
    try {
      setResults(await api.searchSkills(q, k, sort));
      setIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // back to null, not []: a failed search settled NOTHING, so the header must not
      // claim "0 ON MAINNET" and the body renders the error, never a fake empty.
      setResults(null);
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

  async function refreshGithubStatus() {
    const masked = await maskedGithubToken().catch(() => null);
    setGithubStatus({ hasToken: !!masked, masked });
  }

  useEffect(() => {
    void search("", kind);
    void api.solBalance().then(setBalance).catch(() => setBalance(null));
    void refreshRpcStatus();
    void refreshGithubStatus();
    void api.disposedSkillMints?.().then((m) => setDisposedNames(new Set(Object.keys(m)))).catch(() => {});
    // /agents lands straight on the directory; owned needs no fetch (data via prop)
    if (initialStage === "agents") void loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fire(id: string) {
    setFiringIds((s) => new Set(s).add(id));
    setTimeout(() => setFiringIds((s) => { const n = new Set(s); n.delete(id); return n; }), 1500);
  }

  async function openDetail(mint: string) {
    setLoading(true);
    setError(null); // a stale error must not outlive the retry it prompted
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
      // count the new comment immediately: postNote returns no payload, so prepend the
      // note we just wrote (notes are newest-first) instead of waiting for a reload.
      const now = Date.now();
      setDetail((d) => d && {
        ...d,
        notes: [
          {
            id: `${walletAddr}-${now}`,
            author: walletAddr,
            text: commentText.trim(),
            gitLink: commentGitLink.trim() || undefined,
            timestamp: now,
          },
          ...(d.notes ?? []),
        ],
      });
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
      if (missing.length) { setBusy(false); setPubResult(`failed: not owned: ${missing.join(", ")}`); return; }
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
    setError(null); // the error branch must only ever show a failure of THIS fetch
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
    setError(null); // a stale error must not outlive the retry it prompted
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
      setProfileSub(composeKind === "comment" ? "comments" : "blog");
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

  // Save (or, with "", clear) the GitHub token. Mirrors doSaveHeliusKey: core stores it
  // 0600, then we re-read the mask so the badge reflects the new state.
  async function doSaveGithubToken(token: string) {
    setBusy(true);
    await saveGithubToken(token);
    await refreshGithubStatus();
    setBusy(false);
    setGhTokenInput("");
    setGhFlash(token ? "token saved" : "token removed");
  }

  // Register the repo as verified work for the chosen skills. The blockReason gate has
  // already checked token/repo/skill presence, so this just loads the stored token and
  // hands the whole flow to core registerVerifiedWork (marker commit + indexer POST).
  async function doRegisterRepo() {
    const chosen = Object.keys(ghSelected).filter((m) => ghSelected[m]);
    const stored = await loadGithubToken();
    if (!stored || !walletAddr) { setGhFlash("connect a wallet and a GitHub token first"); return; }
    setBusy(true);
    setGhFlash(null);
    try {
      const res = await registerVerifiedWork({
        token: stored.token,
        repo: ghRepoInput.trim(),
        skillMints: chosen,
        walletAddress: walletAddr,
      });
      setGhFlash(`registered ${res.count} link${res.count === 1 ? "" : "s"} for ${res.repo}${res.markerAdded ? " (marker committed)" : ""}`);
      setGhRepoInput("");
      setGhSelected({});
    } catch (e) {
      setGhFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

    // ── github verified work ──────────────────────────────────────────────
    if (stage === "github") {
      // Status still unread from disk: a token may exist, so neither the token form
      // nor its capture may run yet. The panel shows its loading row; esc still backs
      // out, everything else waits for the status to settle.
      if (!githubStatus) {
        if (key.escape) { setGhFlash(null); backOut("github"); }
        return;
      }
      // Token entry: first connect (no token yet) or replacing a stored one via
      // enter on the token row. Enter saves; while a form exists behind it, esc
      // cancels and up/down leave the field with the typed text kept.
      if (!githubStatus.hasToken || ghTokenEditing) {
        if (key.escape) {
          if (githubStatus?.hasToken) { setGhTokenEditing(false); return; }
          setGhFlash(null); backOut("github"); return;
        }
        if (githubStatus?.hasToken && (key.upArrow || key.downArrow)) {
          setGhTokenEditing(false);
          setGhFocusIdx(key.downArrow ? 1 : 0);
          return;
        }
        if (key.return) {
          // replacing a stored token: an empty enter cancels instead of silently
          // clearing the token ([x] on the token row is the remove).
          if (ghTokenEditing && ghTokenInput.trim() === "") { setGhTokenEditing(false); return; }
          setGhTokenEditing(false);
          void doSaveGithubToken(ghTokenInput.trim());
          return;
        }
        if (key.backspace || key.delete) { setGhTokenInput((v) => v.slice(0, -1)); return; }
        if (input && !key.ctrl && !key.meta) { setGhTokenInput((v) => v + input); return; }
        return;
      }
      if (key.escape) { setGhFlash(null); backOut("github"); return; }
      // ONE vertical focus list (order lives in githubRowAt): up/down walk it from
      // anywhere, including the repo input; tab and shift-tab cycle it as an alternate
      // but are never required. Enter acts on whichever row holds focus.
      const ghRows = githubRowCount(ownedList.length);
      const ghIdx = Math.min(ghFocusIdx, ghRows - 1);
      if (key.upArrow) { setGhFocusIdx(Math.max(0, ghIdx - 1)); return; }
      if (key.downArrow) { setGhFocusIdx(Math.min(ghRows - 1, ghIdx + 1)); return; }
      if (key.tab) { setGhFocusIdx(key.shift ? (ghIdx + ghRows - 1) % ghRows : (ghIdx + 1) % ghRows); return; }
      const ghRow = githubRowAt(ghIdx, ownedList.length);
      if (ghRow.kind === "token") {
        if (input === "x") { void doSaveGithubToken(""); return; } // remove token
        if (key.return) { setGhTokenInput(""); setGhTokenEditing(true); return; } // replace it
        return;
      }
      if (ghRow.kind === "skill") {
        if (input === " " || key.return) {
          const cur = ownedList[ghRow.skill];
          if (cur) setGhSelected((s) => ({ ...s, [cur.id]: !s[cur.id] }));
          return;
        }
        return;
      }
      if (ghRow.kind === "register") {
        // fires only when the gate is clear; a blocked enter stays silent because the
        // register row itself already says why not, once, right under the cursor.
        if (key.return && !githubBlockReason) { void doRegisterRepo(); return; }
        return;
      }
      // repo input: printable characters land here ONLY while this row holds focus;
      // enter moves on to the skills (fill repo, pick skills, register).
      if (key.return) { setGhFocusIdx(2); return; }
      if (key.backspace || key.delete) { setGhRepoInput((v) => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setGhRepoInput((v) => v + input); return; }
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
      // the design-22 gate: comment on another agent only while holding a skill they made.
      const canComment =
        !!agentProfile && !agentProfile.self &&
        (agentProfile.createdSkills ?? []).some((s) => owned.has(s.name));
      const openCompose = (mode: "blog" | "comment") => {
        setComposeKind(mode);
        setBlogTitle(""); setBlogText(""); setBlogImage(""); setBlogGitLink("");
        setBlogField(mode === "comment" ? "text" : "title");
        setStage("blogCompose");
      };
      if (profileSub !== "main") {
        if (key.escape) { setProfileSub("main"); setProfileScroll(0); return; }
        if (key.downArrow) { setProfileScroll((o) => clampScroll(o + 1, total, height)); return; }
        if (key.upArrow) { setProfileScroll((o) => clampScroll(o - 1, total, height)); return; }
        if (key.pageDown) { setProfileScroll((o) => clampScroll(o + height, total, height)); return; }
        if (key.pageUp) { setProfileScroll((o) => clampScroll(o - height, total, height)); return; }
        if (profileSub === "blog" && input === "n" && agentProfile?.self) { openCompose("blog"); return; }
        if (profileSub === "comments" && input === "c" && canComment) { openCompose("comment"); return; }
        return;
      }
      if (key.escape) { setStage("agents"); setAgentProfile(null); setAgentBuyResult(null); return; }
      if (input === "r") { setProfileSub("repos"); setProfileScroll(0); return; }
      if (input === "k") { setProfileSub("comments"); setProfileScroll(0); return; }
      if (input === "g") { setProfileSub("blog"); setProfileScroll(0); return; }
      if (input === "n" && agentProfile?.self) { openCompose("blog"); return; }
      if (input === "c" && canComment) { openCompose("comment"); return; }
      if (input === "b" && agentProfile) void doBuyAll(agentProfile.reputation.wallet);
      return;
    }

    // ── agents list ────────────────────────────────────────────────────────
    if (stage === "agents") {
      const filtered = (agents ?? []).filter((a) => !agentQuery.trim() || a.wallet.toLowerCase().includes(agentQuery.toLowerCase()));
      if (agentTyping) {
        if (key.return || key.downArrow) { setAgentTyping(false); setAgentIdx(0); return; }
        if (key.backspace || key.delete) { setAgentQuery((q) => q.slice(0, -1)); return; }
        if (key.escape) { setAgents(null); setError(null); backOut("agents"); return; }
        if (input && !key.ctrl && !key.meta) { setAgentQuery((q) => q + input); return; }
        return;
      }
      if (key.escape) { setAgents(null); setError(null); backOut("agents"); return; }
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
        // clamp against WRAPPED rows, the same lists the subviews render: raw file
        // lines undercount whenever a line wraps at narrow widths, and the constant
        // heights overran short terminals (skillTextLines/commentLines/subViewportH
        // are the one source for both).
        const total = detailSub === "skillText"
          ? skillTextLines(detail, marketCols).length
          : commentLines(detail.notes ?? [], marketCols, walletAddr).length;
        const height = subViewportH(agentRows, total);
        if (key.escape) { setDetailSub("main"); setDetailScroll(0); return; }
        if (key.downArrow) { setDetailScroll((o) => clampScroll(o + 1, total, height)); return; }
        if (key.upArrow) { setDetailScroll((o) => clampScroll(o - 1, total, height)); return; }
        if (key.pageDown) { setDetailScroll((o) => clampScroll(o + height, total, height)); return; }
        if (key.pageUp) { setDetailScroll((o) => clampScroll(o - height, total, height)); return; }
        return;
      }
      // main body scroll - same clamp the subviews use, against the same line list the
      // view renders (mainLines/mainViewportH are the one source for both).
      const mainTotal = mainLines(detail, owned, marketCols).length;
      const mainH = mainViewportH(agentRows, mainTotal);
      if (key.downArrow) { setDetailScroll((o) => clampScroll(o + 1, mainTotal, mainH)); return; }
      if (key.upArrow) { setDetailScroll((o) => clampScroll(o - 1, mainTotal, mainH)); return; }
      if (key.pageDown) { setDetailScroll((o) => clampScroll(o + mainH, mainTotal, mainH)); return; }
      if (key.pageUp) { setDetailScroll((o) => clampScroll(o - mainH, mainTotal, mainH)); return; }
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

    // ── owned collection ───────────────────────────────────────────────────
    if (stage === "owned") {
      const cur = ownedList[Math.min(ownedIdx, ownedList.length - 1)];
      if (key.escape) { backOut("owned"); return; }
      if (key.return && cur) void openDetail(cur.id);
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
    if (input === "g") { setGhFlash(null); setGhFocusIdx(0); setGhTokenEditing(false); setStage("github"); return; }
    if (input === "h") { setHideOwned((v) => !v); setIdx(0); return; }
    if (input === "s") { const next = marketSort === "stars" ? "supply" : "stars"; setMarketSort(next); void search(query, kind, next); return; }
    if (key.tab) {
      const next = kind === "skill" ? "workflow" : "skill";
      setKind(next); void search(query, next); return;
    }
    if (key.upArrow) return setTyping(true); // ←/→ rotate the carousel; ↑ back to search
    if (key.return && selected) return void openDetail(selected.id);
    if (input === "b" && selected && !owned.has(selected.name)) { setDetail(null); setStage("confirm"); }
  });

  // ── helius settings ─────────────────────────────────────────────────────────
  if (stage === "helius") {
    return <HeliusPanel status={rpcStatus} keyInput={heliusKeyInput} busy={busy} flash={heliusFlash} />;
  }

  // ── github verified work ──────────────────────────────────────────────────────
  if (stage === "github") {
    return (
      <GithubPanel
        status={githubStatus}
        tokenInput={ghTokenInput}
        tokenEditing={ghTokenEditing}
        repoInput={ghRepoInput}
        repoLabel={ghParsedRepo ? `${ghParsedRepo.owner}/${ghParsedRepo.name}` : null}
        owned={ownedCollection}
        selected={ghSelected}
        focusIdx={Math.min(ghFocusIdx, githubRowCount(ownedList.length) - 1)}
        blockReason={githubBlockReason}
        busy={busy}
        flash={ghFlash}
        width={Math.max(20, marketCols - 4)}
      />
    );
  }

  // ── blog composer ─────────────────────────────────────────────────────────
  if (stage === "blogCompose") {
    const isComment = composeKind === "comment";
    const labels: Record<BlogField, string> = { title: "title   ", text: "text    ", image: "image   ", gitLink: "gitLink " };
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Box>
          <Band
            label={isComment ? "reply" : "blog"}
            note={isComment ? "TITLE · IMAGE · GITHUB LINK OPTIONAL · POSTS ON CHAIN" : "SELF NOTE · WRITTEN ON CHAIN"}
          />
        </Box>
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
        walletAddr={walletAddr}
      />
    );
  }

  // ── agents list ────────────────────────────────────────────────────────────
  if (stage === "agents") {
    const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
    // wallet-face identity (design tab 20 //AVATAR_): same wallet, same face, every
    // screen. The face sheds below 40 cols, where the row's width budget is already
    // spent on the wallet and the rank label.
    const showFace = marketCols >= 40;
    const filtered = (agents ?? []).filter((a) => !agentQuery.trim() || a.wallet.toLowerCase().includes(agentQuery.toLowerCase()));
    // window to terminal height so every agent stays reachable. Each agent row is now two
    // lines (handle+tier, then stats) plus a gauge line on the selected one, so budget ~2
    // display lines per agent under the title/search/bands chrome.
    const vis = Math.max(2, Math.min(filtered.length, Math.floor((agentRows - 11) / 2)));
    const aStart = Math.max(0, Math.min(agentIdx - Math.floor(vis / 2), Math.max(0, filtered.length - vis)));
    // Footer budget: the tier legend sheds WHOLE below the width where the full hint
    // and the full legend both fit (the sort chip and the wallet face shed the same
    // way); the hint truncates only once the legend is gone. Unmeasured, the two
    // fused into one wrapped run at 40 cols ("↵ profiBRONZE 3 · SILVER").
    const agentHint = agentTyping ? "type to filter · ↵/↓ browse · esc close" : "↑/↓ move · ↵ profile · [/] search · esc back";
    const legendPlain = "BRONZE 3 · SILVER 15 · GOLD 60 · LEGENDARY 250";
    const showLegend = displayWidth(agentHint) + 2 + displayWidth(legendPlain) <= Math.max(12, marketCols - 4);
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Box justifyContent="space-between">
          <Text bold color={colors.bone}>AGENTS</Text>
          <Text dimColor>ranked by copies</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={agentTyping ? colors.iqCyan : colors.dim}>{agentTyping ? "▸ " : "  "}</Text>
          <Text dimColor>filter by wallet </Text>
          <Text>{agentQuery}</Text>
          {agentTyping ? <Text inverse> </Text> : null}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {/* three honest states on the one reserved row: pending says loading (one dim
              word, also true while a profile opens over this stage), a settled failure
              says what failed, and "no agents found" may only follow a SETTLED empty
              fetch. agents === null is the frame before the mount effect fires. */}
          {loading || (agents === null && !error) ? (
            <Text dimColor>loading…</Text>
          ) : error ? (
            <Text color={colors.err}>{error}</Text>
          ) : filtered.length === 0 ? (
            <Text dimColor>no agents found</Text>
          ) : (
            <>
              {aStart > 0 ? <Text dimColor>… {aStart} more above</Text> : null}
              {filtered.slice(aStart, aStart + vis).map((a, wi) => {
                const i = aStart + wi;
                const on = !agentTyping && i === agentIdx;
                const { cur } = tierInfo(a.stars ?? 0);
                const you = a.wallet === walletAddr;
                const earned = a.totalEarned ? sol(Number(a.totalEarned)) : null;
                return (
                  <Box key={a.wallet} flexDirection="column">
                    <Box justifyContent="space-between">
                      <Text>
                        <Text color={on ? colors.iqCyan : colors.bone} bold={on || you}>
                          {on ? "› " : "  "}
                        </Text>
                        {showFace ? <Text color={walletColor(a.wallet)}>{walletFace(a.wallet)} </Text> : null}
                        <Text color={on ? colors.iqCyan : colors.bone} bold={on || you}>
                          {short(a.wallet)}{you ? " // YOU" : ""}
                        </Text>
                      </Text>
                      {/* the rank label wears its metal, so a Legendary row finally
                          matches the green the footer legend promises */}
                      <Text color={cur ? tierColor(cur.name) : colors.dim}>
                        {cur ? cur.name.toUpperCase() : "UNRANKED"}
                      </Text>
                    </Box>
                    {/* earned SOL is green on the profile ("earned 0.70◎"); the same
                        datum was dim here. One rule per datum: earned money is green
                        on both reputation screens. The label stays dim metadata. */}
                    <Text>
                      <Text dimColor>
                        {"    CREATED "}{a.skillsPublished}{" · COPIES "}{a.totalSupply}
                        {" · ★"}{a.stars ?? 0}{earned ? " · EARNED " : ""}
                      </Text>
                      {earned ? <Text color={colors.ok}>{earned}</Text> : null}
                    </Text>
                    {on ? <Text>{"    "}<TierGauge stars={a.stars ?? 0} /></Text> : null}
                  </Box>
                );
              })}
              {aStart + vis < filtered.length ? <Text dimColor>… {filtered.length - aStart - vis} more below</Text> : null}
            </>
          )}
        </Box>
        <Box marginTop={1}>
          <Band label="rank" note="ONLY VERIFIED GITHUB STARS MOVE THE TIER. COPIES CANNOT BUY IT." inverted />
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor wrap="truncate-end">{agentHint}</Text>
          {/* the legend is the color key the rows obey: every rung in its own metal */}
          {showLegend ? (
            <Text>
              <Text color={tierColors.bronze}>BRONZE 3</Text>
              <Text dimColor> · </Text>
              <Text color={tierColors.silver}>SILVER 15</Text>
              <Text dimColor> · </Text>
              <Text color={tierColors.gold}>GOLD 60</Text>
              <Text dimColor> · </Text>
              <Text color={tierColors.legendary}>LEGENDARY 250</Text>
            </Text>
          ) : null}
        </Box>
      </Box>
    );
  }

  // ── publish form ──────────────────────────────────────────────────────────
  if (stage === "publish") {
    if (pubResult) {
      const ok = pubResult.startsWith("published");
      const mint = ok ? pubResult.split("mint:")[1]?.trim() : null;
      return (
        <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={ok ? colors.ok : colors.err}>
          {ok ? (
            <Box flexDirection="column" alignItems="center">
              <Text dimColor>ON SUCCESS</Text>
              <Text bold color={colors.ok}>{glyph.sparkle} {pubKind.toUpperCase()} MINTED {glyph.sparkle}</Text>
              {mint && mint !== "?" ? <Text dimColor>{mint}</Text> : null}
            </Box>
          ) : (
            <Text bold color={colors.err}>{pubResult}</Text>
          )}
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
    // design tab 26 funding gate: know before signing whether the wallet can afford it.
    const priceLamports = card?.price && card.price !== "0" ? Number(card.price) : 0;
    const insufficient = balance != null && priceLamports > 0 && balance < priceLamports;
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={insufficient ? colors.err : colors.warn}>
        <Text bold color={colors.warn}>confirm purchase</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{card?.name}</Text>
          <Text dimColor>{card?.description}</Text>
          <Box marginTop={1}>
            <Text dimColor>price </Text><Text>{priceLamports ? sol(priceLamports) : "FREE"}</Text>
            <Text dimColor>   supply </Text><Text>×{card?.supply ?? 0}</Text>
            <Text dimColor>   your balance </Text>
            <Text color={insufficient ? colors.err : undefined}>{sol(balance)}</Text>
          </Box>
          <Text dimColor>this signs an on-chain transaction and can't be undone</Text>
        </Box>
        {insufficient ? (
          <Box marginTop={1} flexDirection="column">
            <Band label="fund" note="INSUFFICIENT FUNDS" inverted />
            <Text dimColor>
              this buy needs {sol(priceLamports)}. you have {sol(balance)}.
            </Text>
            <Text>
              <Text dimColor>send SOL to </Text>
              <Text color={colors.iqCyan}>{walletAddr}</Text>
            </Text>
            <Box marginTop={1}>
              <Text dimColor>fund the wallet, then </Text>
              <Text color={colors.warn}>[y] retry</Text>
              <Text dimColor> · [n] back</Text>
            </Box>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={colors.warn}>buy "{card?.name}"?  </Text>
            <Text dimColor>[y] yes · [n] no</Text>
          </Box>
        )}
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
        walletAddr={walletAddr}
      />
    );
  }

  // ── owned collection ───────────────────────────────────────────────────────
  if (stage === "owned") {
    const ownedClamped = Math.min(ownedIdx, Math.max(0, ownedList.length - 1));
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ my skills</Text>
        {/* the host is still fetching the wallet's skills (owned === null): say loading
            on the row the empty copy uses, never "no skills owned yet" for an unsettled
            fetch. The empty claim renders only once the fetch settled empty. */}
        {ownedLoading ? (
          <Box marginTop={1}><Text dimColor>loading…</Text></Box>
        ) : ownedList.length === 0 ? (
          <Box marginTop={1}><Text dimColor>no skills owned yet · /market buys one</Text></Box>
        ) : (
          <Box marginTop={1}>
            <ChipCarousel
              items={ownedList}
              index={ownedClamped}
              onIndex={setOwnedIdx}
              chipWidth={SKILL_CHIP_W}
              renderChip={(s, focused) => {
                // tier is best-effort: stars live on the market card, not the owned entry
                const stars = (results ?? []).find((r) => r.id === s.id)?.stars ?? 0;
                const { cur } = tierInfo(stars);
                const off = disposedNames.has(s.name);
                return (
                  <Box
                    flexDirection="column"
                    width={SKILL_CHIP_W}
                    paddingX={1}
                    borderStyle="round"
                    borderColor={focused ? colors.iqCyan : colors.dim}
                  >
                    {/* OWNED asserts ownership, so it is green here like everywhere
                        else (list chip, profile rows); OFF stays dim, it asserts
                        the opposite. The brackets stay structural dim. */}
                    <Text>
                      <Text dimColor>[ </Text>
                      <Text color={off ? colors.dim : colors.ok}>{(off ? "off" : "owned").toUpperCase()}</Text>
                      <Text dimColor> / SKILL ]</Text>
                    </Text>
                    <Text color={focused ? colors.iqCyan : undefined} bold={focused}>
                      {s.name.slice(0, SKILL_CHIP_W - 4)}
                    </Text>
                    <Box>
                      {stars ? <Text color={tierColor(cur?.name)}>★{stars} </Text> : null}
                      {cur ? <Text color={tierColor(cur.name)}>[{cur.name}]</Text> : <Text dimColor>{stars ? "" : "no grade yet"}</Text>}
                    </Box>
                  </Box>
                );
              }}
            />
          </Box>
        )}
        {loading ? <Box marginTop={1}><Text dimColor>opening…</Text></Box> : null}
        {/* a failed openDetail was silent here before: the error the api returned now
            renders instead of leaving the user staring at a stalled carousel. */}
        {error && !loading ? <Box marginTop={1}><Text color={colors.err}>{error}</Text></Box> : null}
        {flash ? <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box> : null}
        <Box marginTop={1}>
          <Text dimColor>←/→ rotate · ↵ open detail · esc chat</Text>
        </Box>
      </Box>
    );
  }

  // ── list ───────────────────────────────────────────────────────────────────
  // the header count is a claim about a SETTLED fetch: before the first search lands
  // (results === null) the number is unknown, so an ellipsis holds its place instead
  // of a false "0 ON MAINNET".
  const onMainnet = results === null
    ? `… ${kind === "skill" ? "SKILLS" : "WORKFLOWS"} ON MAINNET`
    : `${results.length} ${kind === "skill" ? "SKILL" : "WORKFLOW"}${results.length === 1 ? "" : "S"} ON MAINNET`;
  // Width bounds for the chrome rows. Unbounded, their pieces wrapped INTO each other at
  // narrow widths ("MARKE5 SKILLS ON / T MAINNET" at 40 cols); each row now truncates or
  // drops its least important piece instead. innerW = frame border 2 + paddingX 2.
  const innerW = Math.max(12, marketCols - 4);
  const badgePlain = heliusBadgeText(rpcStatus);
  const noteRoom = Math.max(0, innerW - displayWidth("MARKET") - 2);
  const showBadge = badgePlain !== "" && displayWidth(onMainnet) + 3 + displayWidth(badgePlain) <= noteRoom;
  const shortcuts = "[a] agents  [p] publish  [r] rpc  [g] github";
  const shortcutRoom = innerW - displayWidth("skills  ·  workflows  ·  ");
  const sortLabel = marketSort === "stars" ? "★ stars" : "popular";
  const queryShown = truncateStart(query, Math.max(1, innerW - 10));
  const searchUsed = 9 + displayWidth(queryShown) + (typing ? 1 : 0);
  const showHideChip = searchUsed + displayWidth("   [h] hide owned ✓") <= innerW;
  const showSortChip = showHideChip && searchUsed + displayWidth(`   [h] hide owned ✓   [s] sort ${sortLabel}`) <= innerW;
  // ── vertical budget ────────────────────────────────────────────────────────
  // Chrome that always renders: border 2 + header 1 + card 6 + footer 1 =
  // 10 rows. Everything else re-enters as terminal rows allow; read as a
  // drop ladder from the full frame: the blank spacer rows go first
  // (search's, then tabs', then the band's, then the card's), then the buy
  // band, then the carousel count row, then the search row, and LAST the
  // tabs row itself below 12 terminal rows. The tabs row is the right final
  // shed: its shortcut strip already drops piecewise by width, the header's
  // "N SKILLS/WORKFLOWS ON MAINNET" still names the active tab, and the
  // footer hint still carries [tab] switch, whose key keeps working with the
  // row hidden. At 11 rows the old 11 row chrome EQUALLED the terminal,
  // which is already ink's full clear-and-repaint path on every keystroke.
  // While typing, the search row is the interaction surface and never drops.
  // A flash reserves two rows; when not even one spare row exists it takes
  // the footer's hint slot instead of growing the frame.
  const showTabsRow = agentRows >= 12;
  const flashInFooter = flash != null && agentRows < 13;
  const listSpare = Math.max(0, agentRows - 12 - (flash != null && !flashInFooter ? 2 : 0));
  const showSearchRow = typing || listSpare >= 1;
  const showCountRow = listSpare >= 2;
  const showBand = listSpare >= 3;
  const spacerRoom = Math.min(4, Math.max(0, listSpare - 3));
  const hintRoom = Math.max(4, marketCols - 4 - displayWidth(sol(balance)) - 2);
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box justifyContent="space-between">
        <Text bold color={colors.bone}>MARKET</Text>
        <Box>
          <Text dimColor>{truncateEnd(onMainnet, noteRoom)}{showBadge ? "   " : ""}</Text>
          {showBadge ? <HeliusBadge status={rpcStatus} /> : null}
        </Box>
      </Box>
      {/* tabs; the shortcut strip truncates and disappears before the tabs ever wrap */}
      {showTabsRow ? (
        <Box marginTop={spacerRoom >= 3 ? 1 : 0}>
          <Text color={kind === "skill" ? colors.iqCyan : colors.dim} bold={kind === "skill"}>skills</Text>
          <Text dimColor>  ·  </Text>
          <Text color={kind === "workflow" ? colors.iqCyan : colors.dim} bold={kind === "workflow"}>workflows</Text>
          {shortcutRoom >= 4 ? (
            <>
              <Text dimColor>  ·  </Text>
              <Text color={colors.dim}>{truncateEnd(shortcuts, shortcutRoom)}</Text>
            </>
          ) : null}
        </Box>
      ) : null}
      {/* search box + hide-owned filter; chips drop whole before they can interleave */}
      {showSearchRow ? (
        <Box marginTop={spacerRoom >= 4 ? 1 : 0}>
          <Text color={typing ? colors.iqCyan : colors.dim}>{typing ? "▸ " : "  "}</Text>
          <Text dimColor>search </Text>
          <Text>{queryShown}</Text>
          {typing ? <Text inverse> </Text> : null}
          {showHideChip ? (
            <>
              <Text dimColor>   [h] hide owned </Text>
              <Text color={hideOwned ? colors.ok : colors.dim}>{hideOwned ? "✓" : "✗"}</Text>
            </>
          ) : null}
          {showSortChip ? (
            <>
              <Text dimColor>   [s] sort </Text>
              {/* the non-default mode reads at full strength, not amber: amber is a
                  caution color here (confirm, missing key), and a sort mode is not
                  a warning. Bold bone = "this is the live mode", no hue claim. */}
              <Text color={marketSort === "stars" ? colors.bone : colors.dim} bold={marketSort === "stars"}>{sortLabel}</Text>
            </>
          ) : null}
        </Box>
      ) : null}
      {/* results - sd-card chip carousel, ←/→ rotates */}
      <Box flexDirection="column" marginTop={spacerRoom >= 1 ? 1 : 0}>
        {loading || (results === null && !error) ? (
          // pending, including the entry frame before the mount effect fires its first
          // search: the row says loading, never "no skills found" for an unsettled fetch.
          <Text dimColor>searching…</Text>
        ) : error ? (
          <Text color={colors.err}>{error}</Text>
        ) : visibleResults.length === 0 ? (
          // results can exist yet all be hidden by the owned filter (only that filter
          // empties a non-empty result set). "no skills found" here contradicted the
          // "N ON MAINNET" header; say what is hidden and name the key that shows it.
          (results ?? []).length > 0 ? (
            <Text dimColor>all {(results ?? []).length} owned, [h] shows them</Text>
          ) : (
            <Text dimColor>no {kind === "skill" ? "skills" : "workflows"} found</Text>
          )
        ) : (
          <ChipCarousel
            items={visibleResults}
            index={clamped}
            onIndex={setIdx}
            chipWidth={SKILL_CHIP_W}
            count={showCountRow}
            renderChip={(c, focused) => (
              <SkillChip
                card={c}
                focused={!typing && focused}
                isOwned={owned.has(c.name)}
                firing={firingIds.has(c.id)}
              />
            )}
          />
        )}
      </Box>
      {flash && !flashInFooter ? (
        <Box marginTop={spacerRoom >= 1 ? 1 : 0}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box>
      ) : null}
      {showBand ? (
        <Box marginTop={spacerRoom >= 2 ? 1 : 0}>
          <Band label="buy" note="ONE TX: PAY, MINT YOUR COPY, EQUIP IT." inverted />
        </Box>
      ) : null}
      <Box justifyContent="space-between">
        {/* the hint is budgeted against the balance and cut with an ellipsis: unbudgeted,
            the row fused them into one string ("[h] hid7.003 SOL", and at 30 cols
            "[b] 7.003" read like a price). border 2 + paddingX 2 + a 2-cell gap. */}
        {flashInFooter ? (
          <Text color={colors.ok}>{glyph.sparkle} {truncateEnd(flash ?? "", hintRoom)}</Text>
        ) : (
          <Text dimColor>
            {truncateEnd(
              typing
                ? "type to search · ↵ run · [tab] skills/workflows · ↓ results · esc close"
                : "←/→ · ↵ open · [b] buy · [tab] switch · [/] search · [a] agents · [p] publish · [h] hide · [s] sort · esc",
              hintRoom,
            )}
          </Text>
        )}
        <Text dimColor>{sol(balance)}</Text>
      </Box>
    </Box>
  );
}
