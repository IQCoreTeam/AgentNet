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

export async function deleteNote(
  conn: Connection,
  signer: SignerInput,
  noteId: string,
): Promise<void> {
  // Future: implement via deletion marker row or separate deletion table
  throw new Error("deleteNote not yet implemented");
}
