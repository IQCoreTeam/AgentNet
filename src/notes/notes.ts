// On-chain skill notes (comments gated by skill token holding).
//
// Post: verified by balance check (must own ≥1 skill token)
// Read: anyone (public notes table keyed by skill mint)

import { PublicKey, type Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  readRows,
  writeRow,
  ensureTable,
  signerAddress,
} from "../core/chain.js";
import { notesSkillHint, NOTE_COLUMNS } from "../core/seed.js";
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

  // Fast client-side pre-check for a friendly error. The REAL enforcement is the
  // on-chain Token gate on the notes table below (gate_opt) — the IQ contract
  // rejects writes from non-holders, so gating doesn't rely on this check.
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

  // Create the notes table gated by holding the skill token (Token gate, ≥1).
  // The contract enforces this on every subsequent write — native, not manual.
  await ensureTable(signer, hint, NOTE_COLUMNS, "id", {
    gate: { mint: input.skillId, amount: 1 },
  });
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

export async function deleteNote(
  conn: Connection,
  signer: SignerInput,
  noteId: string,
): Promise<void> {
  // Future: implement via deletion marker row or separate deletion table
  throw new Error("deleteNote not yet implemented");
}
