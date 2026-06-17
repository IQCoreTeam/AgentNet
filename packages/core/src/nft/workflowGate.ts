// Calls into the agent-workflow-nft on-chain gate program (raw web3.js, no anchor).
//
// ONE model for skills AND workflows: every item is minted only through this
// program (the item mint's authority is a program PDA), so a token can't be minted
// without going through buy_item. An item's required_skills is empty for a skill
// (anyone can buy) and filled for a workflow (buyer must hold every listed skill).

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { getWorkflowGateProgramId, getFeeTreasury } from "../core/seed.js";

// Anchor instruction discriminators (sha256("global:<name>")[0..8]) — from the IDL.
const DISC_PUBLISH = Buffer.from([125, 80, 203, 31, 0, 230, 147, 33]); // publish_item
const DISC_BUY = Buffer.from([80, 82, 193, 201, 216, 27, 70, 184]); // buy_item

const ITEM_SEED = Buffer.from("item");
const MINT_AUTH_SEED = Buffer.from("mint-auth");
const COLLECTION_AUTH_SEED = Buffer.from("collection-auth");

function programId(): PublicKey {
  return new PublicKey(getWorkflowGateProgramId());
}

/** The program's global collection-authority PDA: ["collection-auth"]. It owns
 *  both official TokenGroups' update authority, so publish_item signs member
 *  enrollment on-chain (no off-chain minter key). */
export function collectionAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync([COLLECTION_AUTH_SEED], programId())[0];
}

/** Config PDA holding an item's required_skills: ["item", itemMint]. */
export function itemConfigPda(itemMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([ITEM_SEED, itemMint.toBuffer()], programId())[0];
}

/** The program's mint-authority PDA for an item: ["mint-auth", itemMint]. */
export function itemMintAuthorityPda(itemMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([MINT_AUTH_SEED, itemMint.toBuffer()], programId())[0];
}

/**
 * publish_item instruction — store creator, price, and required_skills in the
 * config PDA AND mint the first copy to the creator (supply 0 -> 1) via the
 * mint-auth PDA, so the author owns what they publish. required_skills empty = a
 * skill; filled = a workflow (each required skill mint is a remaining account so
 * the program can verify it).
 *
 * The creator's item ATA must already exist — callers prepend an ATA-create ix
 * (see skill.ts / workflow.ts). `creatorItemAta` defaults to the derived ATA.
 */
export function publishItemIx(args: {
  creator: PublicKey;
  itemMint: PublicKey;
  requiredSkills: PublicKey[];
  price: bigint;
  /** The official TokenGroup the item joins (skills OR workflows collection mint).
   *  publish_item enrolls the mint into this group, PDA-signed. */
  group: PublicKey;
}): TransactionInstruction {
  // data: disc(8) + vec<pubkey>(4 len + 32*n) + u64 price(8 LE)
  const n = args.requiredSkills.length;
  const data = Buffer.alloc(8 + 4 + 32 * n + 8);
  let o = 0;
  DISC_PUBLISH.copy(data, o); o += 8;
  data.writeUInt32LE(n, o); o += 4;
  for (const s of args.requiredSkills) { s.toBuffer().copy(data, o); o += 32; }
  data.writeBigUInt64LE(args.price, o);

  const creatorItemAta = getAssociatedTokenAddressSync(
    args.itemMint, args.creator, false, TOKEN_2022_PROGRAM_ID,
  );
  const keys = [
    { pubkey: args.creator, isSigner: true, isWritable: true },
    { pubkey: args.itemMint, isSigner: false, isWritable: true }, // mut: self-mint bumps supply
    { pubkey: itemConfigPda(args.itemMint), isSigner: false, isWritable: true },
    { pubkey: itemMintAuthorityPda(args.itemMint), isSigner: false, isWritable: false },
    { pubkey: creatorItemAta, isSigner: false, isWritable: true }, // receives the 1 self-copy
    { pubkey: args.group, isSigner: false, isWritable: true }, // collection mint — InitializeMember bumps its member count
    { pubkey: collectionAuthorityPda(), isSigner: false, isWritable: false }, // group update authority (program signs via PDA)
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // remaining: the skill mints, one per required_skill (none for a skill).
    ...args.requiredSkills.map((m) => ({ pubkey: m, isSigner: false, isWritable: false })),
  ];
  return new TransactionInstruction({ programId: programId(), keys, data });
}

/**
 * buy_item instruction — the gate. For a workflow, the buyer's skill token
 * accounts are passed as remaining accounts (one per required skill, same order as
 * config.required_skills); the program checks each holds ≥1, then mints the item
 * token. For a skill (empty required_skills) there are no remaining accounts.
 */
export function buyItemIx(args: {
  buyer: PublicKey;
  creator: PublicKey;
  itemMint: PublicKey;
  requiredSkills: PublicKey[];
}): TransactionInstruction {
  const buyerItemAta = getAssociatedTokenAddressSync(
    args.itemMint, args.buyer, false, TOKEN_2022_PROGRAM_ID,
  );
  const keys = [
    { pubkey: args.buyer, isSigner: true, isWritable: true },
    { pubkey: args.creator, isSigner: false, isWritable: true },
    // protocol fee treasury — the program requires this exact account on a priced buy.
    { pubkey: new PublicKey(getFeeTreasury()), isSigner: false, isWritable: true },
    { pubkey: itemConfigPda(args.itemMint), isSigner: false, isWritable: false },
    { pubkey: args.itemMint, isSigner: false, isWritable: true },
    { pubkey: itemMintAuthorityPda(args.itemMint), isSigner: false, isWritable: false },
    { pubkey: buyerItemAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // remaining: the buyer's skill token accounts (ATAs), one per required skill.
    ...args.requiredSkills.map((m) => ({
      pubkey: getAssociatedTokenAddressSync(m, args.buyer, false, TOKEN_2022_PROGRAM_ID),
      isSigner: false,
      isWritable: false,
    })),
  ];
  return new TransactionInstruction({ programId: programId(), keys, data: DISC_BUY });
}
