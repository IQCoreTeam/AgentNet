// Skill NFT operations: publish (code-in → mint, authority = gate PDA) and buy
// (the gate program mints under its PDA authority — no protocol-minter keypair).
//
// A skill is an "item" with NO prerequisites (required_skills = []). Publish/buy
// go through the same gate program as workflows; the gate loop just runs zero
// times for a skill. See nft/workflowGate.ts + the agent-workflow-nft program.

import {
  PublicKey,
  Keypair,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { codeIn, signerAddress, ensureDbRoot } from "../core/chain.js";
import { getSkillsCollectionMint } from "../core/seed.js";
import { createSkillMint } from "./token2022.js";
import { checkFormat, FormatError } from "./checkFormat.js";
import { publishItemIx, buyItemIx, itemMintAuthorityPda } from "./workflowGate.js";
import { sendTx } from "./workflow.js";

export interface PublishSkillInput {
  name: string;
  description: string;
  text: string; // SKILL.md content (codeIn auto-chunks if large)
  category?: string; // e.g. "clean-code"
  hashtags?: string[]; // e.g. ["refactoring"]
  price?: bigint; // lamports (0 = free)
}

/**
 * Publish a skill. The skill mint's authority is the gate program's mint-auth PDA
 * (so only buy_item can mint it), and its config (price, empty required_skills) is
 * registered on-chain via publish_item.
 */
export async function publishSkill(
  conn: Connection,
  signer: SignerInput,
  input: PublishSkillInput,
): Promise<string> {
  const format = checkFormat(input.text);
  if (!format.ok) {
    throw new FormatError(format.errors);
  }

  await ensureDbRoot(signer);

  // code-in the standard NFT JSON (skill-nft-json.md §2): name/description +
  // standard `attributes` (category once, each hashtag as a repeated "skill"
  // trait, §4) + the SKILL.md body in `skillText`. One inscription holds
  // everything search/detail needs — traits do NOT go on the mint.
  const attributes: { trait_type: string; value: string }[] = [];
  if (input.category) attributes.push({ trait_type: "category", value: input.category });
  for (const tag of input.hashtags ?? []) attributes.push({ trait_type: "skill", value: tag });
  const skillJson = JSON.stringify({
    name: input.name,
    description: input.description,
    attributes,
    skillText: input.text,
  });
  const skillTxid = await codeIn(signer, skillJson, `${input.name}.json`, "application/json");

  // Pre-generate the mint → derive the gate PDA that will own the mint authority.
  const skillMintKp = Keypair.generate();
  const skillMint = skillMintKp.publicKey;
  const mintAuthority = itemMintAuthorityPda(skillMint);

  const collectionStr = getSkillsCollectionMint();
  const collectionMint = collectionStr ? new PublicKey(collectionStr) : undefined;

  await createSkillMint(conn, signer, {
    name: input.name,
    symbol: input.name.substring(0, 8).toUpperCase(),
    uri: skillTxid, // points at the JSON above (traits live there, not on the mint)
    collectionMint,
    mintKeypair: skillMintKp,
    minterAuthority: mintAuthority, // gate PDA holds the mint authority
  });

  // Register the item config on-chain. A skill has NO prerequisites.
  const creator = new PublicKey(await signerAddress(signer));
  const ix = publishItemIx({
    creator,
    itemMint: skillMint,
    requiredSkills: [],
    price: input.price ?? 0n,
  });
  await sendTx(conn, signer, [ix]);

  return skillMint.toBase58();
}

export interface BuySkillInput {
  skillId: string; // skill mint address
  buyerWallet: string; // wallet buying the skill
  creatorWallet: string; // paid the price (read from the item config on-chain)
}

/**
 * Buy a skill (star = soulbound purchase = equip). Calls buy_item: there is no
 * prerequisite gate for a skill, so the program pays the creator (if priced) and
 * mints 1 token under its PDA authority. No protocol-minter keypair needed.
 */
export async function buySkill(
  conn: Connection,
  signer: SignerInput,
  input: BuySkillInput,
): Promise<string> {
  const buyer = new PublicKey(input.buyerWallet);
  const skillMint = new PublicKey(input.skillId);

  // buy_item needs the buyer's skill ATA to exist; create it if missing.
  const ixs: TransactionInstruction[] = [];
  const buyerAta = getAssociatedTokenAddressSync(skillMint, buyer, false, TOKEN_2022_PROGRAM_ID);
  if ((await conn.getAccountInfo(buyerAta)) === null) {
    const payer = new PublicKey(await signerAddress(signer));
    ixs.push(
      createAssociatedTokenAccountInstruction(payer, buyerAta, buyer, skillMint, TOKEN_2022_PROGRAM_ID),
    );
  }
  ixs.push(
    buyItemIx({
      buyer,
      creator: new PublicKey(input.creatorWallet),
      itemMint: skillMint,
      requiredSkills: [], // skills have no gate
    }),
  );
  return sendTx(conn, signer, ixs);
}
