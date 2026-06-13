import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";

import { codeIn, signerAddress, ensureDbRoot } from "../core/chain.js";
import { getWorkflowsCollectionMint } from "../core/seed.js";
import { createSkillMint } from "./token2022.js";
import { checkWorkflowFormat, FormatError } from "./checkFormat.js";
import {
  publishItemIx,
  buyItemIx,
  itemMintAuthorityPda,
} from "./workflowGate.js";

export interface PublishWorkflowInput {
  name: string;
  description: string;
  text: string; // SKILL.md content (must include type: workflow & requiredSkills)
  requiredSkills: string[];
  category?: string;
  hashtags?: string[];
  price?: bigint;
}

/**
 * Publish a workflow. The workflow mint's authority is set to the gate program's
 * mint-auth PDA (so only buy_workflow can mint it), and the prerequisites are
 * registered on-chain via publish_workflow.
 */
export async function publishWorkflow(
  conn: Connection,
  signer: SignerInput,
  input: PublishWorkflowInput,
): Promise<string> {
  const format = checkWorkflowFormat(input.text);
  if (!format.ok) {
    throw new FormatError(format.errors);
  }

  await ensureDbRoot(signer);

  // code-in the standard NFT JSON (skill-nft-json.md §2, §4b): same shape as a
  // skill — category once, each hashtag a repeated "skill" trait — plus one
  // "requiredSkill" trait per prerequisite (valued by the skill's mint id, §4b).
  // The body (recipe) goes in skillText. Traits live here, not on the mint.
  const attributes: { trait_type: string; value: string }[] = [];
  if (input.category) attributes.push({ trait_type: "category", value: input.category });
  for (const tag of input.hashtags ?? []) attributes.push({ trait_type: "skill", value: tag });
  for (const mint of input.requiredSkills) attributes.push({ trait_type: "requiredSkill", value: mint });
  const workflowJson = JSON.stringify({
    name: input.name,
    description: input.description,
    attributes,
    skillText: input.text,
  });
  const workflowTxid = await codeIn(signer, workflowJson, `${input.name}.json`, "application/json");

  // Pre-generate the mint so we know its address → derive the gate PDA that will
  // OWN the mint authority. Only the gate program can then mint this workflow.
  const workflowMintKp = Keypair.generate();
  const workflowMint = workflowMintKp.publicKey;
  const mintAuthority = itemMintAuthorityPda(workflowMint);

  const collectionStr = getWorkflowsCollectionMint();
  const collectionMint = collectionStr ? new PublicKey(collectionStr) : undefined;

  await createSkillMint(conn, signer, {
    name: input.name,
    symbol: input.name.substring(0, 8).toUpperCase(),
    uri: workflowTxid, // points at the JSON above (traits live there, not on the mint)
    collectionMint,
    mintKeypair: workflowMintKp,
    minterAuthority: mintAuthority, // gate PDA holds the mint authority
  });

  // Register the prerequisites on-chain (config PDA). The program verifies each
  // required skill is an official-collection member and rejects duplicates.
  const creator = new PublicKey(await signerAddress(signer));
  const ix = publishItemIx({
    creator,
    itemMint: workflowMint,
    requiredSkills: input.requiredSkills.map((s) => new PublicKey(s)),
    price: input.price ?? 0n,
  });
  await sendTx(conn, signer, [ix]);

  return workflowMint.toBase58();
}

export interface UnlockWorkflowInput {
  workflowId: string;
  buyerWallet: string;
  creatorWallet: string;
  requiredSkills: string[]; // the workflow's prerequisite skill mints (in order)
}

/**
 * Buy (unlock) a workflow via the gate program. There is NO client-side balance
 * check anymore — the program enforces it on-chain (buy_workflow reverts if the
 * buyer is missing any required skill), and pays the creator + mints the workflow
 * token under the program's mint-authority PDA. The buyer signs and pays fees.
 */
export async function unlockWorkflow(
  conn: Connection,
  signer: SignerInput,
  input: UnlockWorkflowInput,
): Promise<string> {
  const buyer = new PublicKey(input.buyerWallet);
  const workflowMint = new PublicKey(input.workflowId);
  const requiredSkills = input.requiredSkills.map((s) => new PublicKey(s));

  // buy_workflow needs the buyer's workflow ATA to exist; create it if missing.
  const ixs: TransactionInstruction[] = [];
  const buyerAta = getAssociatedTokenAddressSync(workflowMint, buyer, false, TOKEN_2022_PROGRAM_ID);
  if ((await conn.getAccountInfo(buyerAta)) === null) {
    const payer = new PublicKey(await signerAddress(signer));
    ixs.push(
      createAssociatedTokenAccountInstruction(payer, buyerAta, buyer, workflowMint, TOKEN_2022_PROGRAM_ID),
    );
  }
  ixs.push(
    buyItemIx({ buyer, creator: new PublicKey(input.creatorWallet), itemMint: workflowMint, requiredSkills }),
  );
  return sendTx(conn, signer, ixs);
}

// Sign (Keypair or WalletSigner) + send + confirm a set of instructions. The
// signer is also the fee payer. Shared by skill.ts (the gate flow is identical).
export async function sendTx(
  conn: Connection,
  signer: SignerInput,
  ixs: TransactionInstruction[],
): Promise<string> {
  const payerPk = new PublicKey(await signerAddress(signer));
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerPk;

  const s = signer as any;
  let raw: Uint8Array;
  if ("secretKey" in s) {
    tx.partialSign(s);
    raw = tx.serialize();
  } else {
    raw = (await s.signTransaction(tx)).serialize();
  }
  const sig = await conn.sendRawTransaction(raw);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  return sig;
}
