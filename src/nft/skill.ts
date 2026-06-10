// Skill NFT operations: publish (code-in → mint) and buy (atomic payment + mint).
//
// publishSkill: text → code-in txid → Token-2022 mint with uri=txid + traits
// buySkill: star = atomic (transfer payment + mint token); price 0 = free equip

import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
} from "@solana/spl-token";
import {
  codeIn,
  signerAddress,
  ensureDbRoot,
  writeRow,
} from "../core/chain.js";
import { AUDIT_HINT } from "../core/seed.js";
import type { Skill } from "../core/types.js";
import { createSkillMint, mintSkillToken } from "./token2022.js";
import { defaultValidator, ValidationError } from "./validation/index.js";
import type { ValidationAdapter } from "./validation/index.js";

export interface PublishSkillInput {
  name: string;
  description: string;
  text: string; // SKILL.md content (≤700B inline or chunked)
  category?: string; // e.g. "clean-code"
  hashtags?: string[]; // e.g. ["refactoring"]
  price?: bigint; // lamports (0 = free)
  /** Validation adapter to run before publishing. Defaults to OnchainAdapter. */
  validator?: ValidationAdapter;
}

/**
 * Publish a skill to the on-chain skill hub.
 *
 * Steps:
 * 1. code-in the skill text → get txid
 * 2. create Token-2022 mint with uri=txid, NonTransferable, traits
 * 3. write skill metadata to on-chain
 *
 * Returns: skill ID (mint address)
 */
export async function publishSkill(
  conn: Connection,
  signer: SignerInput,
  input: PublishSkillInput,
): Promise<string> {
  // 0. Validate skill before touching the chain
  const validator = input.validator ?? defaultValidator;
  const validation = await validator.validate(input.text);
  if (!validation.ok) {
    throw new ValidationError(validation.errors);
  }

  // Ensure core structures exist.
  await ensureDbRoot(signer);

  // 1. code-in the skill text
  const skillTextTxid = await codeIn(
    signer,
    input.text,
    `${input.name}.md`,
    "text/markdown",
  );

  // 2. create the Token-2022 mint
  const creator = await signerAddress(signer);
  const skillMintAddr = await createSkillMint(conn, signer, {
    name: input.name,
    symbol: input.name.substring(0, 8).toUpperCase(),
    uri: skillTextTxid,
    category: input.category,
    hashtags: input.hashtags,
  });

  // 3. Index skill metadata for search + reputation
  const skillId = skillMintAddr.toBase58();
  const row: Skill = {
    id: skillId,
    name: input.name,
    description: input.description,
    creator,
    category: input.category ?? "",
    hashtags: input.hashtags,
    type: "skill",
    price: input.price,
    supply: 0,
    uriTxid: skillTextTxid,
    createdAt: Date.now(),
  };
  await writeRow(signer, AUDIT_HINT, JSON.stringify(row));

  return skillId;
}

export interface BuySkillInput {
  skillId: string; // skill mint address
  buyerWallet: string; // wallet buying the skill (NOT always = signer)
  price?: bigint; // price in lamports; 0 = free
  creatorWallet: string; // for payment routing
  iqFeePercent?: number; // IQ treasury fee (e.g. 0.05 = 5%)
  iqTreasuryWallet?: string; // IQ fee recipient (default: protocol treasury)
}

const DEFAULT_IQ_TREASURY = "11111111111111111111111111111111"; // placeholder

/**
 * Buy a skill (star = soulbound purchase = equip).
 *
 * Atomic transaction:
 * 1. If price > 0: transfer to creator + iqfee to treasury
 * 2. Mint 1 skill token to buyer (supply++)
 *
 * The same function handles free (price=0) and paid purchases.
 *
 * Returns: tx signature
 */
export async function buySkill(
  conn: Connection,
  signer: SignerInput,
  input: BuySkillInput,
): Promise<string> {
  const price = input.price ?? 0n;
  const feePercent = input.iqFeePercent ?? 0.05; // 5% default
  const buyer = new PublicKey(input.buyerWallet);
  const creator = new PublicKey(input.creatorWallet);
  const treasury = new PublicKey(input.iqTreasuryWallet ?? DEFAULT_IQ_TREASURY);
  const skillMint = new PublicKey(input.skillId);
  const payer = await signerAddress(signer);
  const payerPk = new PublicKey(payer);

  const tx = new Transaction();

  // 1. If price > 0: transfer payment
  if (price > 0n) {
    const creatorShare = price - BigInt(Math.floor(Number(price) * feePercent));
    const iqFee = price - creatorShare;

    // Creator payment
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payerPk,
        toPubkey: creator,
        lamports: Number(creatorShare),
      }),
    );

    // IQ fee
    if (iqFee > 0n) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payerPk,
          toPubkey: treasury,
          lamports: Number(iqFee),
        }),
      );
    }
  }

  // 2. Mint skill token to buyer (atomic with payment transfer above)
  const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ");
  const ata = getAssociatedTokenAddressSync(skillMint, buyer, false, TOKEN_2022_PROGRAM_ID);

  // Create ATA if needed (getAccountInfo returns null for missing accounts, never throws)
  const ataInfo = await conn.getAccountInfo(ata);
  if (ataInfo === null) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payerPk,
        ata,
        buyer,
        skillMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Mint 1 token
  tx.add(
    createMintToInstruction(
      skillMint,
      ata,
      payerPk, // mint authority
      1,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  // Sign and send
  const signerFull = signer as any;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerPk;

  if ("secretKey" in signerFull) {
    tx.sign(signerFull);
  } else if ("signTransaction" in signerFull) {
    const signed = await signerFull.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    return sig;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  return sig;
}
