// On-chain notes (notes.md). One row shape, split by subject (tables renamed
// notes→reviews, keyed by collection-then-item — see onchain-format/tables.md §2):
//   - reviews:[collectionId]:[itemNFT] — comments on a skill/workflow item,
//     gated by holding that item's token
//   - reviews:agent:[agentWallet]      : reputation comments on an agent, plus
//     the agent's replies within those threads
//   - blog:agent:[agentWallet]         : the owner's blog posts (issue #203
//     table split; posts written pre-split still sit in reviews:agent as
//     self-notes, readers dedupe by id)
//   - feed:blog                        : the global feed ANCHOR every post
//     mirrors into (not a created table; see seed.ts FEED_BLOG_HINT)
//
// Read: anyone (public tables keyed by subject address).
// Write gate (notes.md §2): see postNote / postAgentNote. Gates are CLIENT-SIDE
// — the deployed IQ contract's native gate can't verify a Token-2022 mint (see
// the long note in postNote), and "holds any of an agent's skills" is a multi-
// mint OR the single-mint gate can't express anyway.

import { type Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  readRows,
  readRowsByPda,
  readThreads,
  writeRow,
  ensureTable,
  signerAddress,
  feedPda,
} from "../core/chain.js";
import { reviewsHint, reviewsAgentHint, blogAgentHint, blogCommentsHint, FEED_BLOG_HINT, REVIEW_COLUMNS } from "../core/seed.js";
import { type SkillSource } from "../core/skillSource.js";
import type { Note, Row, ThreadNode, ThreadedReply } from "../core/types.js";
import { heldSkillMints, heldSkillCreators } from "./holdings.js";

/** The stored row shape — derived fields (subject/isSelfNote) are NOT included.
 *  title/image are NOT top-level (REVIEW_COLUMNS has no such columns — see
 *  seed.ts) — they're folded into `meta` by buildNote and pulled back out by
 *  hydrateNotes. */
interface StoredNote {
  id: string;
  author: string;
  text: string;
  gitLink?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

/** Build the trimmed row + a collision-resistant id (author:ts:nonce). `gitLink`/`meta`
 *  are only written when present, so old + new rows coexist. title/image ride inside
 *  `meta` (no top-level column for them — writeRow rejects unknown keys). */
function buildNote(
  author: string,
  text: string,
  gitLink?: string,
  meta?: Record<string, unknown>,
  title?: string,
  image?: string,
  parentId?: string,
): StoredNote {
  const nonce = Math.random().toString(36).slice(2, 8);
  const row: StoredNote = {
    id: `note:${author}:${Date.now()}:${nonce}`,
    author,
    text,
    timestamp: Date.now(),
  };
  if (gitLink !== undefined) row.gitLink = gitLink;
  const mergedMeta = { ...meta };
  if (title !== undefined) mergedMeta.title = title;
  if (image !== undefined) mergedMeta.image = image;
  // Threading (GH #101): a reply is an ordinary row carrying one new fact —
  // meta.parentId = id of the row it replies to. No parentId → top-level.
  // Stored only inside meta (no column change); tree/depth/counts are derived
  // at read time by threadReplies (single source of truth — nothing derivable
  // is stored).
  if (parentId !== undefined) mergedMeta.parentId = parentId;
  if (Object.keys(mergedMeta).length > 0) row.meta = mergedMeta;
  return row;
}

/**
 * Map stored rows → Note[], deriving the non-stored fields from the subject
 * (the table key): `subject` = subject, `isSelfNote` = author == subject.
 * Drops non-row entries (metadata shapes from readTableRows have no `id`).
 * Pulls title/image back out of `meta` (falling back to legacy top-level
 * values, for any pre-fix rows written before the columns existed).
 */
function hydrateNotes(rows: Row[], subject: string): Note[] {
  return (rows as unknown as Note[])
    .filter((n) => typeof n.id === "string")
    .map((n) => {
      const meta = (n as { meta?: Record<string, unknown> }).meta;
      const title = n.title ?? (meta?.title as string | undefined);
      const image = n.image ?? (meta?.image as string | undefined);
      const parentId = n.parentId ?? (meta?.parentId as string | undefined);
      return { ...n, title, image, parentId, subject, isSelfNote: n.author === subject };
    });
}

export interface PostNoteInput {
  collectionId: string; // umbrella collection mint (skills / workflows / …)
  skillId: string; // item NFT mint address (= the table subject, under the collection)
  text: string;
  title?: string;
  gitLink?: string;
  image?: string;
  meta?: Record<string, unknown>;
  parentId?: string; // GH #101: id of the note this replies to; omit for top-level
}

export async function postNote(
  conn: Connection,
  signer: SignerInput,
  input: PostNoteInput,
): Promise<string> {
  const author = await signerAddress(signer);

  // Write gate: caller must hold the skill's Token-2022 soulbound token
  // (notes.md §2 — "wallets that hold that skill's token").
  //
  // Resolved via the per-owner cached holdings set (heldSkillMints) — ONE
  // getTokenAccountsByOwner read covers every skill and is reused across comments,
  // instead of a per-mint getAccount that re-hits the (flaky) RPC for each gate. It
  // is the SAME source as the owned-skills list, so "UI shows it owned" and "gate
  // accepts it" can never disagree.
  //
  // Real enforcement is the table's ON-CHAIN Token gate (set at create, below): the IQ
  // contract checks the holder's Token-2022 ATA on every write (SDK >= 0.1.28 derives the
  // 2022 ATA, so the gate is usable for our mints). This heldSkillMints check is a fast-fail
  // pre-check so a non-holder never sends a doomed tx. Tables created before the gate landed
  // stay open; new ones (first comment on a skill) are gated going forward.
  const held = await heldSkillMints(author);
  if (!held.has(input.skillId)) {
    throw new Error(`Must own ≥1 skill token to post note`);
  }

  const hint = reviewsHint(input.collectionId, input.skillId);
  const note = buildNote(author, input.text, input.gitLink, input.meta, input.title, input.image, input.parentId);

  // Create the table gated by the item mint (Token gate); the first commenter creates it,
  // and the IQ contract then checks the holder's Token-2022 ATA on every write.
  await ensureTable(signer, hint, REVIEW_COLUMNS, "id", { gate: { mint: input.skillId } });
  await writeRow(signer, hint, JSON.stringify(note));
  return note.id;
}

export interface ReadNotesOptions {
  limit?: number;
}

export async function readNotes(
  collectionId: string,
  skillId: string,
  options?: ReadNotesOptions,
): Promise<Note[]> {
  const hint = reviewsHint(collectionId, skillId);
  const rows = await readRows(hint, { limit: options?.limit ?? 100 });
  return hydrateNotes(rows, skillId);
}

// ===== Agent notes: blog posts (blog:agent:[wallet]) + reputation comments (reviews:agent:[wallet]) =====

export interface PostAgentNoteInput {
  agentWallet: string; // subject — the agent's wallet (the reviews:agent:[agentWallet] table key)
  text: string;
  title?: string;
  gitLink?: string;
  image?: string;
  meta?: Record<string, unknown>;
  parentId?: string; // GH #101: id of the note this replies to; omit for top-level
  /** Skill source to enumerate the agent's skills for the comment gate. */
  source?: SkillSource;
}

/**
 * Write a note onto an agent's profile (notes.md §1/§2/§3).
 *
 * Two flavors, told apart by author (notes.md §3 — "no flag, derive from
 * author"):
 *   - SELF-NOTE  (author == agentWallet): the owner posting on their own
 *     profile ("I built this", blog). Always allowed. A top-level self-note
 *     is a BLOG POST and is stored in blog:agent:[wallet] (issue #203).
 *   - COMMENT    (author != agentWallet): someone else. Gated per notes.md §2's
 *     open decision (§4) — we require the author to hold ≥1 of the agent's
 *     published skills (sybil bar: commenters must have bought in, same
 *     rationale as skill comments). If the agent has no skills, only self-notes
 *     are possible.
 *
 * The gate is CLIENT-SIDE (see the module header for why a native gate can't
 * apply here). Returns the note id.
 */
export async function postAgentNote(
  conn: Connection,
  signer: SignerInput,
  input: PostAgentNoteInput,
): Promise<string> {
  const author = await signerAddress(signer);
  const isSelfNote = author === input.agentWallet;

  if (!isSelfNote) {
    // Comment gate: must hold ≥1 skill this agent created. Resolved from ON-CHAIN
    // ground truth — the creator (TokenMetadata.updateAuthority) of the skills the
    // author actually holds — NOT by enumerating the agent's skills via the indexer.
    // The indexer catalog under-reports our Token-2022 members, so listSkills()∩creator
    // missed skills the agent made that the commenter genuinely holds, wrongly blocking
    // legit holders (verified on devnet: a wallet holding 6 of an agent's skills was
    // rejected because none were in the agent's 24-item catalog projection).
    const creators = await heldSkillCreators(author); // mint → creator, our-collection only
    let holdsAny = false;
    for (const creator of creators.values()) if (creator === input.agentWallet) { holdsAny = true; break; }
    if (!holdsAny) {
      throw new Error(
        `Must hold ≥1 of ${input.agentWallet}'s skills to comment on this agent`,
      );
    }
  }

  // Table split (issue #203): a TOP-LEVEL self-note is a blog post and lives in
  // the agent's own blog:agent table. Everything else (reputation comments AND
  // the owner's replies inside those threads, self-note + parentId) stays in
  // reviews:agent so comment threading is never split across tables.
  const isBlogPost = isSelfNote && !input.parentId;
  const hint = isBlogPost ? blogAgentHint(input.agentWallet) : reviewsAgentHint(input.agentWallet);
  const note = buildNote(author, input.text, input.gitLink, input.meta, input.title, input.image, input.parentId);

  // Open table (no native gate — see the module header).
  await ensureTable(signer, hint, REVIEW_COLUMNS, "id");
  // A blog post also mirrors into the global feed anchor so the cross-agent
  // FEED (issues #183/#203) is one read instead of one per agent. Same
  // transaction (writeRow remainingAccounts), no extra cost; comments and
  // reviews stay off the feed. The anchor mechanism stamps the SAME row json
  // under the feed address; the preview shape is projected at read time
  // (readBlogFeed), never stored separately.
  const mirrors = isBlogPost ? [feedPda(FEED_BLOG_HINT)] : undefined;
  await writeRow(signer, hint, JSON.stringify(note), mirrors);
  return note.id;
}

/**
 * The global blog feed (issues #183/#203: RANK -> FEED): every agent's blog
 * posts, newest first, from ONE read of the feed anchor. The anchor mirrors
 * the SAME row json as the blog:agent write (remainingAccounts cannot carry a
 * second payload in one instruction), so the feed is a passthrough of the
 * mirrored rows: the full body is already in hand, and rendering follows the
 * X model client side (short posts in full, long posts clamped with an inline
 * Show more). No preview projection, no on-open re-fetch; opening a post
 * loads only its comments.
 *
 * TRUST (v1, two live users): the anchor is permissionless, so any wallet can
 * mirror a row naming any author. The cheap reader-side check stays: a row
 * whose id does not embed its claimed author (buildNote's note:<author>:
 * shape) is dropped. If the feed later opens to arbitrary writers, revisit
 * spoof handling then (gateway-side verification, or an on-open re-fetch
 * from the author's own table); see tables.md. Rows that do not look like
 * blog posts are dropped, never thrown on; a re-mirrored id (migration
 * backfill) shows once.
 */
export async function readBlogFeed(options?: { limit?: number }): Promise<Note[]> {
  const rows = await readRowsByPda(feedPda(FEED_BLOG_HINT), { limit: options?.limit ?? 100 });
  const seen = new Set<string>();
  const posts: Note[] = [];
  for (const r of rows) {
    const author = (r as { author?: unknown }).author;
    if (typeof author !== "string" || !author) continue;
    const note = hydrateNotes([r], author)[0];
    // The id ties the row to its claimed author (buildNote); a mismatch is a
    // forgery or junk, not a post.
    if (!note || !note.id.startsWith(`note:${author}:`) || note.parentId || seen.has(note.id)) continue;
    seen.add(note.id);
    posts.push(note);
  }
  return posts.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Read an agent's notes. `selfOnly` returns just the owner's blog posts (the
 * blog view); default returns posts + comments merged (the Community view),
 * newest first. Posts and comments live in separate tables since the issue
 * #203 split, so both are read (one cached gateway call each) and merged.
 * Posts written PRE-split still sit in reviews:agent as self-notes and are
 * kept until migrated; the merge dedupes by id (blog row wins) so a migrated
 * post never shows twice (the chain is append-only, the old row stays).
 */
export async function readAgentNotes(
  agentWallet: string,
  options?: ReadNotesOptions & { selfOnly?: boolean },
): Promise<Note[]> {
  const limit = options?.limit ?? 100;
  const [blogRows, reviewRows] = await Promise.all([
    readRows(blogAgentHint(agentWallet), { limit }),
    readRows(reviewsAgentHint(agentWallet), { limit }),
  ]);
  const notes = hydrateNotes(blogRows, agentWallet); // subject + isSelfNote derived
  const seen = new Set(notes.map((n) => n.id));
  for (const n of hydrateNotes(reviewRows, agentWallet)) {
    if (!seen.has(n.id)) notes.push(n);
  }
  const wanted = options?.selfOnly ? notes.filter((n) => n.isSelfNote && !n.parentId) : notes;
  return wanted.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteNote(
  conn: Connection,
  signer: SignerInput,
  noteId: string,
): Promise<void> {
  // Future: implement via deletion marker row or separate deletion table
  throw new Error("deleteNote not yet implemented");
}

// ===== Threading (GH #101) — read-time derivation, nothing stored but parentId =====

/**
 * Group a flat note list into threads (GH #101). Derives the tree at read time
 * from `parentId` alone — no threadRoot/depth/count is stored (single source of
 * truth). Rules (owner-locked, comment #4870…):
 *   - No `parentId`, or a `parentId` that isn't in this list (orphan) → the note
 *     is top-level. Read-side resilience: a reply whose parent didn't load still
 *     shows up rather than vanishing.
 *   - Every reply collapses under its nearest top-level ancestor (2-level render
 *     cap); `parentAuthor` preserves who it actually replied to.
 *   - Top-level order follows input order (callers pass newest-first); replies
 *     within a thread are sorted oldest-first (natural reading order).
 * Pure — safe to run client-side or in the indexer.
 */
export function threadReplies(notes: Note[]): ThreadNode[] {
  const byId = new Map<string, Note>();
  for (const n of notes) byId.set(n.id, n);

  // Walk parentId up to the top-level ancestor. Bounded by note count so a
  // malformed cycle (a→b→a) can't spin forever — it just resolves to itself.
  const rootOf = (n: Note): Note => {
    let cur = n;
    for (let hops = 0; hops < byId.size; hops++) {
      const parent = cur.parentId ? byId.get(cur.parentId) : undefined;
      if (!parent) return cur; // no/orphan parent → this is the top
      cur = parent;
    }
    return cur;
  };

  const nodes = new Map<string, ThreadNode>();
  const order: string[] = [];
  const ensure = (note: Note): ThreadNode => {
    let node = nodes.get(note.id);
    if (!node) {
      node = { note, replies: [] };
      nodes.set(note.id, node);
      order.push(note.id);
    }
    return node;
  };

  for (const n of notes) {
    const root = rootOf(n);
    if (root.id === n.id) {
      ensure(n); // top-level
    } else {
      const parentAuthor = n.parentId ? byId.get(n.parentId)?.author : undefined;
      ensure(root).replies.push({ ...n, parentAuthor });
    }
  }

  for (const node of nodes.values()) {
    node.replies.sort((a, b) => a.timestamp - b.timestamp);
  }
  return order.map((id) => nodes.get(id)!);
}

/**
 * Read an agent's comments already grouped into threads (GH #101). Gateway-first:
 * the gateway's /threads endpoint does the parentId grouping server-side (one call,
 * shared cache), so no client re-derives the tree. Falls back to reading flat rows
 * and grouping locally with threadReplies when the gateway is absent or errors, so
 * an outage degrades to "slower", not "broken". Both paths return the same shape and
 * obey the same rules (the gateway mirrors threadReplies), so consumers can adopt
 * this seam and drop their own assembly.
 */
export async function readAgentThreads(
  agentWallet: string,
  options?: { limit?: number },
): Promise<ThreadNode[]> {
  const limit = options?.limit ?? 100;
  try {
    // Two tables since the issue #203 split: reviews threads come grouped from
    // the gateway; blog posts are flat rows that render as their own top-level
    // nodes (a post's replies live in comment:blog:{postId}, fetched on open,
    // so an empty replies list is correct). A migrated post exists in both
    // tables under one id; the reviews thread wins (it may carry replies).
    const [threads, blogRows] = await Promise.all([
      readThreads(reviewsAgentHint(agentWallet), limit),
      readRows(blogAgentHint(agentWallet), { limit }),
    ]);
    const nodes: ThreadNode[] = [];
    for (const t of threads) {
      const note = hydrateNotes([t.op], agentWallet)[0];
      if (!note) continue; // op row missing an id (metadata shape) — skip
      const replies: ThreadedReply[] = [];
      for (const r of t.replies) {
        const reply = hydrateNotes([r], agentWallet)[0];
        if (reply) replies.push({ ...reply, parentAuthor: (r as { parentAuthor?: string }).parentAuthor });
      }
      nodes.push({ note, replies });
    }
    const opIds = new Set(nodes.map((n) => n.note.id));
    for (const post of hydrateNotes(blogRows, agentWallet)) {
      if (!opIds.has(post.id)) nodes.push({ note: post, replies: [] });
    }
    return nodes.sort((a, b) => b.note.timestamp - a.note.timestamp);
  } catch {
    const notes = await readAgentNotes(agentWallet, { limit });
    return threadReplies(notes);
  }
}

// ===== Blog-post comments (comment:blog:[postId]) — one thread per post =====
// A blog post is a self-note living in blog:agent:[agentWallet] (issue #203);
// its comments live in their OWN per-post table keyed by the post's id
// (tables.md §0), keyed by id, not by the post's home table, which is what
// let the #203 split move the post body without touching any comment. The
// first commenter creates the table (ensureTable), the rest just writeRow.

export interface PostBlogCommentInput {
  postId: string; // the blog post's note id — the comment:blog:[postId] table subject
  agentWallet: string; // the post's author/agent — context only (replies are open, no gate)
  text: string;
  gitLink?: string;
  parentId?: string; // GH #101: id of the comment this replies to; omit for top-level
  meta?: Record<string, unknown>;
}

/**
 * Write a reply onto ONE blog post's table (comment:blog:[postId]).
 *
 * OPEN to anyone with a wallet (issue #183 post-discussion model). This is
 * deliberately DIFFERENT from agent REPUTATION comments (reviews:agent:<wallet>
 * via postAgentNote), which stay holder-gated because they shape the agent's
 * standing — a post reply does not, so it needs no skill. The first replier
 * creates the per-post table. Returns the note id.
 */
export async function postBlogComment(
  conn: Connection,
  signer: SignerInput,
  input: PostBlogCommentInput,
): Promise<string> {
  const author = await signerAddress(signer);
  // No holder gate: any connected wallet may reply. input.agentWallet is kept only
  // as context (which agent's post this is), not as a permission check.

  const hint = blogCommentsHint(input.postId);
  // Blog comments carry no title/image (those are the post's, in blog:agent).
  const note = buildNote(author, input.text, input.gitLink, input.meta, undefined, undefined, input.parentId);

  await ensureTable(signer, hint, REVIEW_COLUMNS, "id");
  await writeRow(signer, hint, JSON.stringify(note));
  return note.id;
}

/**
 * Read ONE blog post's comments, grouped into threads (GH #101). Gateway-first
 * (server-side parentId grouping), falling back to a flat read + threadReplies.
 * Subject is the postId, so hydrateNotes' isSelfNote is always false here — a
 * post's table holds only comments, never the post itself.
 */
export async function readBlogCommentThreads(
  postId: string,
  options?: { limit?: number },
): Promise<ThreadNode[]> {
  const limit = options?.limit ?? 100;
  const hint = blogCommentsHint(postId);
  try {
    const threads = await readThreads(hint, limit);
    const nodes: ThreadNode[] = [];
    for (const t of threads) {
      const note = hydrateNotes([t.op], postId)[0];
      if (!note) continue; // op row missing an id (metadata shape) — skip
      const replies: ThreadedReply[] = [];
      for (const r of t.replies) {
        const reply = hydrateNotes([r], postId)[0];
        if (reply) replies.push({ ...reply, parentAuthor: (r as { parentAuthor?: string }).parentAuthor });
      }
      nodes.push({ note, replies });
    }
    return nodes;
  } catch {
    const rows = await readRows(hint, { limit });
    const notes = hydrateNotes(rows, postId).sort((a, b) => b.timestamp - a.timestamp);
    return threadReplies(notes);
  }
}
