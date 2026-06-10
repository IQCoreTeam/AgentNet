// On-chain notes (notes.md). Two subjects, same row shape:
//   - notes/[skillNFT]   — comments on a skill, gated by holding the skill token
//   - notes/[agentWallet] — comments on an agent + the owner's self-notes (blog)
//
// Read: anyone (public tables keyed by subject address).
// Write gate (notes.md §2): see postNote / postAgentNote. Gates are CLIENT-SIDE
// — the deployed IQ contract's native gate can't verify a Token-2022 mint (see
// the long note in postNote), and "holds any of an agent's skills" is a multi-
// mint OR the single-mint gate can't express anyway.

import { PublicKey, type Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  readRows,
  writeRow,
  ensureTable,
  signerAddress,
} from "../core/chain.js";
import { notesSkillHint, notesAgentHint, NOTE_COLUMNS } from "../core/seed.js";
import { indexTableSource, type SkillSource } from "../core/skillSource.js";
import type { Note, Row } from "../core/types.js";
import { getBalance } from "./balance.js";

export interface PostNoteInput {
  skillId: string; // skill mint address
  subject: string;
  text: string;
  gitLink?: string;
}

export async function postNote(
  conn: Connection,
  signer: SignerInput,
  input: PostNoteInput,
): Promise<string> {
  const author = await signerAddress(signer);

  // Write gate: caller must hold ≥1 of the skill's Token-2022 soulbound token
  // (notes.md §2 — "wallets that hold that skill's token").
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
  const balance = await getBalance(
    conn,
    new PublicKey(input.skillId),
    new PublicKey(author),
  );
  if (balance < 1n) {
    throw new Error(`Must own ≥1 skill token to post note (balance: ${balance})`);
  }

  const hint = notesSkillHint(input.skillId);
  const noteId = `note:${author}:${Date.now()}`;
  const note: Note = {
    id: noteId,
    author,
    subject: input.subject,
    text: input.text,
    gitLink: input.gitLink,
    isSelfNote: false,
    timestamp: Date.now(),
  };

  // Open table (no native gate — see the Token-2022 incompatibility above).
  await ensureTable(signer, hint, NOTE_COLUMNS, "id");
  await writeRow(signer, hint, JSON.stringify(note));
  return noteId;
}

export interface ReadNotesOptions {
  limit?: number;
}

export async function readNotes(
  conn: Connection,
  skillId: string,
  options?: ReadNotesOptions,
): Promise<Note[]> {
  const hint = notesSkillHint(skillId);
  const rows = await readRows(hint, {
    limit: options?.limit ?? 100,
  });
  // Drop non-row entries (metadata shapes from readTableRows have no `id`).
  return (rows as unknown as Note[]).filter((n) => typeof n.id === "string");
}

// ===== Agent notes (notes/[agentWallet]) — self-notes + others' comments =====

export interface PostAgentNoteInput {
  agentWallet: string; // subject — the agent's wallet (the notes/[agentWallet] table key)
  text: string;
  gitLink?: string;
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
    const source = input.source ?? indexTableSource;
    const agentSkills = (await source.listSkills()).filter(
      (s) => s.creator === input.agentWallet,
    );
    const authorPk = new PublicKey(author);
    const balances = await Promise.all(
      agentSkills.map((s) => getBalance(conn, new PublicKey(s.id), authorPk)),
    );
    const holdsAny = balances.some((b) => b >= 1n);
    if (!holdsAny) {
      throw new Error(
        `Must hold ≥1 of ${input.agentWallet}'s skills to comment on this agent`,
      );
    }
  }

  const hint = notesAgentHint(input.agentWallet);
  const noteId = `note:${author}:${Date.now()}`;
  const note: Note = {
    id: noteId,
    author,
    subject: input.agentWallet,
    text: input.text,
    gitLink: input.gitLink,
    isSelfNote,
    timestamp: Date.now(),
  };

  // Open table (no native gate — see the module header).
  await ensureTable(signer, hint, NOTE_COLUMNS, "id");
  await writeRow(signer, hint, JSON.stringify(note));
  return noteId;
}

/**
 * Read an agent's notes (self-notes + comments). `selfOnly` returns just the
 * owner's posts (the blog view); default returns everything, newest first.
 */
export async function readAgentNotes(
  conn: Connection,
  agentWallet: string,
  options?: ReadNotesOptions & { selfOnly?: boolean },
): Promise<Note[]> {
  const hint = notesAgentHint(agentWallet);
  const rows = await readRows(hint, { limit: options?.limit ?? 100 });
  let notes = (rows as unknown as Note[]).filter((n) => typeof n.id === "string");
  if (options?.selfOnly) {
    notes = notes.filter((n) => n.author === agentWallet);
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
