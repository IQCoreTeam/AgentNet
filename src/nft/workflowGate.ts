// Calls into the agent-workflow-nft on-chain gate program (raw web3.js, no anchor).
//
// Workflows are minted ONLY through this program: the workflow mint's authority is
// a program PDA, so a workflow token can't be minted without passing the on-chain
// prerequisite check. publishWorkflowGate registers the prerequisites; buyWorkflowGate
// runs the gate + mints. Skills do NOT use this — they're bought directly.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { getWorkflowGateProgramId } from "../core/seed.js";

// Anchor instruction discriminators (sha256("global:<name>")[0..8]) — from the IDL.
const DISC_PUBLISH = Buffer.from([67, 53, 166, 229, 64, 38, 9, 215]);
const DISC_BUY = Buffer.from([245, 235, 217, 127, 91, 196, 97, 19]);

const WORKFLOW_SEED = Buffer.from("workflow");
const MINT_AUTH_SEED = Buffer.from("mint-auth");

function programId(): PublicKey {
  return new PublicKey(getWorkflowGateProgramId());
}

/** Config PDA holding a workflow's required_skills: ["workflow", workflowMint]. */
export function workflowConfigPda(workflowMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([WORKFLOW_SEED, workflowMint.toBuffer()], programId())[0];
}

/** The program's mint-authority PDA for a workflow: ["mint-auth", workflowMint]. */
export function workflowMintAuthorityPda(workflowMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([MINT_AUTH_SEED, workflowMint.toBuffer()], programId())[0];
}

/**
 * publish_workflow instruction — store required_skills + price in the config PDA.
 * Each required skill mint is passed as a remaining account (same order) so the
 * program can verify it belongs to the official skills collection.
 */
export function publishWorkflowIx(args: {
  creator: PublicKey;
  workflowMint: PublicKey;
  requiredSkills: PublicKey[];
  price: bigint;
}): TransactionInstruction {
  // data: disc(8) + vec<pubkey>(4 len + 32*n) + u64 price(8 LE)
  const n = args.requiredSkills.length;
  const data = Buffer.alloc(8 + 4 + 32 * n + 8);
  let o = 0;
  DISC_PUBLISH.copy(data, o); o += 8;
  data.writeUInt32LE(n, o); o += 4;
  for (const s of args.requiredSkills) { s.toBuffer().copy(data, o); o += 32; }
  data.writeBigUInt64LE(args.price, o);

  const keys = [
    { pubkey: args.creator, isSigner: true, isWritable: true },
    { pubkey: args.workflowMint, isSigner: false, isWritable: false },
    { pubkey: workflowConfigPda(args.workflowMint), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // remaining: the skill mints, one per required_skill.
    ...args.requiredSkills.map((m) => ({ pubkey: m, isSigner: false, isWritable: false })),
  ];
  return new TransactionInstruction({ programId: programId(), keys, data });
}

/**
 * buy_workflow instruction — the gate. The buyer's skill token accounts are passed
 * as remaining accounts (one per required skill, same order as the config's
 * required_skills); the program checks each holds ≥1, then mints the workflow token.
 */
export function buyWorkflowIx(args: {
  buyer: PublicKey;
  creator: PublicKey;
  workflowMint: PublicKey;
  requiredSkills: PublicKey[];
}): TransactionInstruction {
  const buyerWorkflowAta = getAssociatedTokenAddressSync(
    args.workflowMint, args.buyer, false, TOKEN_2022_PROGRAM_ID,
  );
  const keys = [
    { pubkey: args.buyer, isSigner: true, isWritable: true },
    { pubkey: args.creator, isSigner: false, isWritable: true },
    { pubkey: workflowConfigPda(args.workflowMint), isSigner: false, isWritable: false },
    { pubkey: args.workflowMint, isSigner: false, isWritable: true },
    { pubkey: workflowMintAuthorityPda(args.workflowMint), isSigner: false, isWritable: false },
    { pubkey: buyerWorkflowAta, isSigner: false, isWritable: true },
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
