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

import { codeIn, signerAddress, ensureDbRoot, itemMetadataUri } from "../core/chain.js";
import { getWorkflowsCollectionMint } from "../core/seed.js";
import { trackSignatures, estimatePublishSigns, type PublishProgress } from "./skill.js";
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
  onProgress?: (p: PublishProgress) => void,
): Promise<string> {
  const format = checkWorkflowFormat(input.text);
  if (!format.ok) {
    throw new FormatError(format.errors);
  }

  // code-in the standard NFT JSON (skill-nft-json.md §2, §4b): same shape as a
  // skill — category once, each hashtag a repeated "skill" trait — plus one
  // "requiredSkill" trait per prerequisite (valued by the skill's mint id, §4b).
  // The body (recipe) goes in skillText. Traits live here, not on the mint.
  // Built before the first tx so the signature total can be predicted.
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

  // Same signature-counting gauge as publishSkill, tagged "workflow" so the UI tints it
  // amber instead of violet. `phase` is updated before each on-chain stage.
  let phase: PublishProgress["phase"] = "store";
  let signed = 0;
  const total = onProgress
    ? await estimatePublishSigns(conn, signer, workflowJson, `${input.name}.json`)
    : undefined;
  const tx = onProgress
    ? trackSignatures(signer, () => { signed += 1; onProgress({ phase, signed, total, kind: "workflow" }); })
    : signer;
  if (onProgress) onProgress({ phase, signed, total, kind: "workflow" }); // 0/N before the first prompt

  await ensureDbRoot(tx);

  phase = "store";
  const workflowTxid = await codeIn(
    tx,
    workflowJson,
    `${input.name}.json`,
    "application/json",
    onProgress ? (percent) => onProgress({ phase: "store", signed, total, percent, kind: "workflow" }) : undefined,
  );

  // Pre-generate the mint so we know its address → derive the gate PDA that will
  // OWN the mint authority. Only the gate program can then mint this workflow.
  const workflowMintKp = Keypair.generate();
  const workflowMint = workflowMintKp.publicKey;
  const mintAuthority = itemMintAuthorityPda(workflowMint);

  // The workflows collection is required: the mint reserves member space for it
  // and publish_item enrolls the mint into it on-chain (PDA-signed).
  const collectionStr = getWorkflowsCollectionMint();
  if (!collectionStr) throw new Error("Workflows collection mint is not configured");
  const collectionMint = new PublicKey(collectionStr);

  phase = "mint";
  if (onProgress) onProgress({ phase, signed, total, kind: "workflow" });
  await createSkillMint(conn, tx, {
    name: input.name,
    symbol: input.name.substring(0, 8).toUpperCase(),
    // Gateway presentation URL (marketplaces resolve it for JSON+image); its
    // last segment is the code-in txid, which on-chain readers extract.
    uri: itemMetadataUri(workflowMint.toBase58(), workflowTxid),
    collectionMint,
    mintKeypair: workflowMintKp,
    minterAuthority: mintAuthority, // gate PDA holds the mint authority
  });

  // Register the prerequisites on-chain (config PDA) AND self-mint the first copy
  // to the creator (supply 0 -> 1), so its ATA must exist first. The program
  // verifies each required skill is an official-collection member, no duplicates.
  const creator = new PublicKey(await signerAddress(tx));
  const creatorAta = getAssociatedTokenAddressSync(workflowMint, creator, false, TOKEN_2022_PROGRAM_ID);
  const ataIx = createAssociatedTokenAccountInstruction(creator, creatorAta, creator, workflowMint, TOKEN_2022_PROGRAM_ID);
  const ix = publishItemIx({
    creator,
    itemMint: workflowMint,
    requiredSkills: input.requiredSkills.map((s) => new PublicKey(s)),
    price: input.price ?? 0n,
    group: collectionMint, // workflows collection — publish_item enrolls the mint
  });
  phase = "list";
  if (onProgress) onProgress({ phase, signed, total, kind: "workflow" });
  await sendTx(conn, tx, [ataIx, ix]);

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
  const confirmation = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  // confirmTransaction resolves once the tx LANDS — even when it reverted. A
  // confirmed tx can still carry an execution error (value.err); ignoring it meant a
  // reverted buy_item/publish_item returned a signature and the caller reported
  // "Successfully purchased" while nothing was minted — surfacing later as
  // "Must own ≥1 skill token to post note (balance: 0)" because the soulbound token
  // was never created. Surface the real on-chain failure (with logs) instead.
  // (?. — the unit-test conn mock resolves {}, no .value: treated as success.)
  if (confirmation?.value?.err) {
    throw new Error(`Transaction ${sig} failed on-chain: ${await txErrorDetail(conn, sig)}`);
  }
  return sig;
}

/** Fetch a confirmed tx's program logs for a human-readable revert reason. Best-effort. */
async function txErrorDetail(conn: Connection, sig: string): Promise<string> {
  try {
    const tx = await conn.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    const err = JSON.stringify(tx?.meta?.err);
    const logs = tx?.meta?.logMessages?.slice(-8).join("\n");
    return logs ? `${err}\n${logs}` : err;
  } catch {
    return "unknown (could not fetch tx logs)";
  }
}
