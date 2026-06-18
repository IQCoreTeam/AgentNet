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
  writeRow,
  ensureTable,
  signerAddress,
} from "../core/chain.js";
import { reviewsHint, reviewsAgentHint, REVIEW_COLUMNS } from "../core/seed.js";
import { dasSource, type SkillSource } from "../core/skillSource.js";
import type { Note, Row } from "../core/types.js";
import { heldSkillMints } from "./holdings.js";

/** The stored row shape — derived fields (subject/isSelfNote) are NOT included. */
interface StoredNote {
  id: string;
  author: string;
  text: string;
  gitLink?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

/** Build the trimmed row + a collision-resistant id (author:ts:nonce). */
function buildNote(
  author: string,
  text: string,
  gitLink?: string,
  meta?: Record<string, unknown>,
): StoredNote {
  const nonce = Math.random().toString(36).slice(2, 8);
  const row: StoredNote = {
    id: `note:${author}:${Date.now()}:${nonce}`,
    author,
    text,
    timestamp: Date.now(),
  };
  if (gitLink !== undefined) row.gitLink = gitLink;
  if (meta !== undefined) row.meta = meta;
  return row;
}

/**
 * Map stored rows → Note[], deriving the non-stored fields from the subject
 * (the table key): `subject` = subject, `isSelfNote` = author == subject.
 * Drops non-row entries (metadata shapes from readTableRows have no `id`).
 */
function hydrateNotes(rows: Row[], subject: string): Note[] {
  return (rows as unknown as Note[])
    .filter((n) => typeof n.id === "string")
    .map((n) => ({ ...n, subject, isSelfNote: n.author === subject }));
}

export interface PostNoteInput {
  collectionId: string; // umbrella collection mint (skills / workflows / …)
  skillId: string; // item NFT mint address (= the table subject, under the collection)
  text: string;
  gitLink?: string;
  meta?: Record<string, unknown>;
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
  const note = buildNote(author, input.text, input.gitLink, input.meta);

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
  gitLink?: string;
  meta?: Record<string, unknown>;
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
    // Comment gate: must hold ≥1 of any skill this agent created.
    const source = input.source ?? dasSource;
    const agentSkills = (await source.listSkills()).filter(
      (s) => s.creator === input.agentWallet,
    );
    // One cached holdings read, then a local membership test — not one RPC per skill.
    const held = await heldSkillMints(author);
    const holdsAny = agentSkills.some((s) => held.has(s.id));
    if (!holdsAny) {
      throw new Error(
        `Must hold ≥1 of ${input.agentWallet}'s skills to comment on this agent`,
      );
    }
  }

  const hint = reviewsAgentHint(input.agentWallet);
  const note = buildNote(author, input.text, input.gitLink, input.meta);

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
