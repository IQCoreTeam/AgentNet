import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Keypair,
  type Connection,
} from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
} from "@solana/spl-token";

import { codeIn, signerAddress, ensureDbRoot, ensureTable, writeRow } from "../core/chain.js";
import { SKILLS_INDEX_HINT, SKILLS_INDEX_COLUMNS, getWorkflowsCollectionMint } from "../core/seed.js";
import { createSkillMint } from "./token2022.js";
import { resolveMinter } from "./minter.js";
import { getBalance } from "../notes/balance.js";
import {
  defaultWorkflowValidator,
  ValidationError,
  type ValidationAdapter,
} from "./validation/index.js";

export class PrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrerequisiteError";
  }
}

export interface PublishWorkflowInput {
  name: string;
  description: string;
  text: string; // SKILL.md content (must include type: workflow & requiredSkills)
  requiredSkills: string[];
  category?: string;
  hashtags?: string[];
  price?: bigint;
  validator?: ValidationAdapter;
}

/**
 * Publish a workflow to the on-chain hub.
 * Identical to publishSkill, but uses WorkflowAdapter by default to ensure
 * requiredSkills is properly configured.
 */
export async function publishWorkflow(
  conn: Connection,
  signer: SignerInput,
  input: PublishWorkflowInput,
): Promise<string> {
  const validator = input.validator ?? defaultWorkflowValidator;
  const validation = await validator.validate(input.text);
  if (!validation.ok) {
    throw new ValidationError(validation.errors);
  }

  await ensureDbRoot(signer);

  // code-in the workflow text
  const workflowTxid = await codeIn(
    signer,
    input.text,
    `${input.name}.md`,
    "text/markdown",
  );

  // create the Token-2022 mint (soulbound)
  // Workflows use the same token pattern as skills.
  const collectionStr = getWorkflowsCollectionMint();
  const collectionMint = collectionStr ? new PublicKey(collectionStr) : undefined;
  
  const workflowMintAddr = await createSkillMint(conn, signer, {
    name: input.name,
    symbol: input.name.substring(0, 8).toUpperCase(),
    uri: workflowTxid,
    category: input.category,
    hashtags: input.hashtags,
    collectionMint,
  });

  // Index workflow for search + reputation
  const workflowId = workflowMintAddr.toBase58();
  const creator = await signerAddress(signer);
  const row = {
    id: workflowId,
    name: input.name,
    description: input.description,
    creator,
    category: input.category ?? "",
    hashtags: input.hashtags,
    type: "workflow",
    requiredSkills: input.requiredSkills,
    price: input.price?.toString(),
    supply: 0,
    uriTxid: workflowTxid,
    createdAt: Date.now(),
  };
  await ensureTable(signer, SKILLS_INDEX_HINT, SKILLS_INDEX_COLUMNS, "id");
  await writeRow(signer, SKILLS_INDEX_HINT, JSON.stringify(row));

  return workflowId;
}

export interface UnlockWorkflowInput {
  workflowId: string;
  buyerWallet: string;
  creatorWallet: string;
  requiredSkills: string[]; // passed by client after fetching workflow metadata
  price?: bigint;
  iqFeePercent?: number;
  iqTreasuryWallet?: string;
  /** Protocol minter (mint authority). Defaults to env AGENTNET_MINTER_SECRET. */
  minter?: Keypair;
}

// Sentinel: the all-1s address is the System Program, NOT a real wallet. When the
// treasury is unset we must NOT route fee here (transfer to System Program fails /
// burns) — instead the fee is skipped and the full price goes to the creator.
const DEFAULT_IQ_TREASURY = "11111111111111111111111111111111";

/**
 * Unlock a workflow (mint workflow token).
 *
 * Checks that the buyer holds ALL required skills (balance >= 1 each). This stays
 * a manual multi-mint check (not the SDK's single-mint table gate) because the
 * gate is an AND over N skill mints at mint time, not a per-table write gate —
 * the native gate_opt can express "hold mint X", not "hold all of X, Y, Z".
 * If it passes, proceeds atomically: transfer payment (if price > 0) and mint.
 */
export async function unlockWorkflow(
  conn: Connection,
  signer: SignerInput,
  input: UnlockWorkflowInput,
): Promise<string> {
  const buyer = new PublicKey(input.buyerWallet);

  // 1. Prerequisite Gate: Verify the buyer holds all required skills.
  for (const skillMintStr of input.requiredSkills) {
    const skillMint = new PublicKey(skillMintStr);
    const bal = await getBalance(conn, skillMint, buyer);
    if (bal < 1n) {
      throw new PrerequisiteError(
        `Wallet does not hold required skill token: ${skillMintStr}`,
      );
    }
  }

  // 2. Prepare atomic payment and mint
  const price = input.price ?? 0n;
  const feePercent = input.iqFeePercent ?? 0.05;
  const creator = new PublicKey(input.creatorWallet);
  const treasuryAddr = input.iqTreasuryWallet ?? DEFAULT_IQ_TREASURY;
  const hasTreasury = treasuryAddr !== DEFAULT_IQ_TREASURY;
  const workflowMint = new PublicKey(input.workflowId);
  const payer = await signerAddress(signer);
  const payerPk = new PublicKey(payer);

  const tx = new Transaction();

  if (price > 0n) {
    // Fee only applies when a real treasury is set; otherwise full price → creator.
    const iqFee = hasTreasury
      ? BigInt(Math.floor(Number(price) * feePercent))
      : 0n;
    const creatorShare = price - iqFee;

    tx.add(
      SystemProgram.transfer({
        fromPubkey: payerPk,
        toPubkey: creator,
        lamports: Number(creatorShare),
      }),
    );

    if (iqFee > 0n) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payerPk,
          toPubkey: new PublicKey(treasuryAddr),
          lamports: Number(iqFee),
        }),
      );
    }
  }

  // Path A: workflow mint authority is the protocol minter (handed over at
  // publish in createSkillMint), so the minter co-signs the mintTo. Buyer pays.
  const minter = resolveMinter(input.minter);
  const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ");
  const ata = getAssociatedTokenAddressSync(workflowMint, buyer, false, TOKEN_2022_PROGRAM_ID);

  const ataInfo = await conn.getAccountInfo(ata);
  if (ataInfo === null) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payerPk,
        ata,
        buyer,
        workflowMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Mint 1 token — authority = protocol minter (co-signs below).
  tx.add(
    createMintToInstruction(
      workflowMint,
      ata,
      minter.publicKey,
      1,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signerFull = signer as any;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerPk;
  tx.partialSign(minter);

  if ("secretKey" in signerFull) {
    tx.partialSign(signerFull);
  } else if ("signTransaction" in signerFull) {
    const signed = await signerFull.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    return sig;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  return sig;
}
