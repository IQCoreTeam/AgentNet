// On-chain notes (notes.md). Two subjects, same row shape (tables renamed
// notes→reviews, keyed by collection-then-item — see onchain-format/tables.md §2):
//   - reviews:[collectionId]:[itemNFT] — comments on a skill/workflow item,
//     gated by holding that item's token
//   - reviews:agent:[agentWallet]      — comments on an agent + the owner's
//     self-notes (blog)
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
  readThreads,
  writeRow,
  ensureTable,
  signerAddress,
} from "../core/chain.js";
import { reviewsHint, reviewsAgentHint, REVIEW_COLUMNS } from "../core/seed.js";
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
  // ⚠️ Enforced CLIENT-SIDE only. coding-info §B3 assumed the IQ contract's
  // native `gate_opt` would enforce this on-chain for free, but that path is
  // structurally incompatible with Token-2022: the SDK derives the gate ATA with
  // the LEGACY token program id in the seeds (utils/ata.js), while skill mints
  // live under the Token-2022 program. The holder's real (2022) ATA address
  // never matches → resolveSignerAta throws "missing signer_ata" on EVERY write,
  // even for legit holders, making a natively-gated table unusable. Until the
  // SDK/contract resolves a Token-2022 ATA (or gates by collection metadata),
  // the table is open and this check is the guard. An attacker calling writeRow
  // directly bypasses it — real enforcement needs SDK Token-2022 support.
  const held = await heldSkillMints(author);
  if (!held.has(input.skillId)) {
    throw new Error(`Must own ≥1 skill token to post note`);
  }

  const hint = reviewsHint(input.collectionId, input.skillId);
  const note = buildNote(author, input.text, input.gitLink, input.meta, input.title, input.image, input.parentId);

  // Open table (no native gate — see the Token-2022 incompatibility above).
  await ensureTable(signer, hint, REVIEW_COLUMNS, "id");
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

// ===== Agent notes (reviews:agent:[agentWallet]) — self-notes + others' comments =====

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
 *     profile ("I built this", blog). Always allowed.
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

  const hint = reviewsAgentHint(input.agentWallet);
  const note = buildNote(author, input.text, input.gitLink, input.meta, input.title, input.image, input.parentId);

  // Open table (no native gate — see the module header).
  await ensureTable(signer, hint, REVIEW_COLUMNS, "id");
  await writeRow(signer, hint, JSON.stringify(note));
  return note.id;
}

/**
 * Read an agent's notes (self-notes + comments). `selfOnly` returns just the
 * owner's posts (the blog view); default returns everything, newest first.
 */
export async function readAgentNotes(
  agentWallet: string,
  options?: ReadNotesOptions & { selfOnly?: boolean },
): Promise<Note[]> {
  const hint = reviewsAgentHint(agentWallet);
  const rows = await readRows(hint, { limit: options?.limit ?? 100 });
  let notes = hydrateNotes(rows, agentWallet); // subject + isSelfNote derived
  if (options?.selfOnly) {
    notes = notes.filter((n) => n.isSelfNote);
  }
  return notes.sort((a, b) => b.timestamp - a.timestamp);
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
    const threads = await readThreads(reviewsAgentHint(agentWallet), limit);
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
    return nodes;
  } catch {
    const notes = await readAgentNotes(agentWallet, { limit });
    return threadReplies(notes);
  }
}
