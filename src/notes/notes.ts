// On-chain skill notes (comments gated by skill token holding).
//
// Post: verified by balance check (must own ≥1 skill token)
// Read: anyone (public notes table keyed by skill mint)

import { PublicKey, type Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  readRows,
  writeRow,
  signerAddress,
} from "../core/chain.js";
import { notesSkillHint } from "../core/seed.js";
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

  // Verify author owns ≥1 skill token
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
  return rows as unknown as Note[];
}

export async function deleteNote(
  conn: Connection,
  signer: SignerInput,
  noteId: string,
): Promise<void> {
  // Future: implement via deletion marker row or separate deletion table
  throw new Error("deleteNote not yet implemented");
}
