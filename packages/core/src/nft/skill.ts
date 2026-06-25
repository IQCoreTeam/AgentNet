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
import type { SignerInput, WalletSigner } from "@iqlabs-official/solana-sdk/utils";
import { codeIn, signerAddress, ensureDbRoot } from "../core/chain.js";
import { getSkillsCollectionMint } from "../core/seed.js";
import { createSkillMint } from "./token2022.js";
import { checkFormat, FormatError } from "./checkFormat.js";
import { publishItemIx, buyItemIx, itemMintAuthorityPda } from "./workflowGate.js";
import { sendTx } from "./workflow.js";

/** Default publish price: 0.1 SOL. Explicit `price: 0n` publishes free. */
export const DEFAULT_SKILL_PRICE_LAMPORTS = 100_000_000n;

// Publish is several on-chain txs (code-in the body → mint → list), each a separate
// wallet signature — and the body itself may chunk into many code-in signatures. With a
// web wallet that's a prompt per signature, so we surface progress. The exact total isn't
// known up front (chunk count depends on body size), so we report named phases + a live
// signature count; `percent` carries the code-in sub-progress within the store phase.
export interface PublishProgress {
  phase: "store" | "mint" | "list";
  signed: number; // cumulative wallet signatures so far
  percent?: number; // 0..100 within the store (code-in) phase
  kind: "skill" | "workflow"; // colors the gauge/celebration (skill = violet, workflow = amber)
}

// Count every wallet signature by wrapping signTransaction. Keypair signers sign locally
// with no prompt, so they pass through untouched (no progress is meaningful there). Shared
// with publishWorkflow so both publish flows report signatures identically.
export function trackSignatures(signer: SignerInput, onSign: () => void): SignerInput {
  const ws = signer as Partial<WalletSigner>;
  if (typeof ws.signTransaction !== "function" || "secretKey" in (signer as object)) {
    return signer;
  }
  return {
    publicKey: ws.publicKey,
    signAllTransactions: ws.signAllTransactions?.bind(ws),
    async signTransaction(tx: Parameters<WalletSigner["signTransaction"]>[0]) {
      const r = await ws.signTransaction!(tx);
      onSign();
      return r;
    },
  } as SignerInput;
}

export interface PublishSkillInput {
  name: string;
  description: string;
  text: string; // SKILL.md content (codeIn auto-chunks if large)
  category?: string; // e.g. "clean-code"
  hashtags?: string[]; // e.g. ["refactoring"]
  price?: bigint; // lamports (0n = free, omit = DEFAULT_SKILL_PRICE_LAMPORTS)
  // optional cover image (skill-nft-json.md §3). The value's SHAPE says where it
  // lives — no isOnchain flag: an http URL / *.png renders directly, a base58
  // txid/PDA is an on-chain (code-in) image decoded via the gateway. Omit = the
  // viewer's default skill-document art. Uploading an image on-chain is a later
  // step (see https://x.com/spacebuneth/status/2064477269871960574).
  image?: string;
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
  onProgress?: (p: PublishProgress) => void,
): Promise<string> {
  // Validate the skill the way it will actually exist: a SKILL.md whose frontmatter
  // (name/description) comes from the separate form fields, with the body field used
  // as the body. The body field holds the body ONLY — the publisher does NOT repeat
  // name/description as `---` frontmatter inside it, so nothing is stored twice (the
  // on-chain skillText below is body-only; toSkillMd re-synthesizes frontmatter from
  // name/description at install). A legacy body that already carries its own
  // frontmatter is validated verbatim for backward compatibility.
  const hasOwnFrontmatter = /^﻿?---\s*\n[\s\S]*?\n---\s*(\n|$)/.test(input.text);
  const descLine = input.description.replace(/\s*\n\s*/g, " ").trim();
  const mdToCheck = hasOwnFrontmatter
    ? input.text
    : `---\nname: ${input.name}\ndescription: ${descLine}\n---\n\n${input.text}`;
  const format = checkFormat(mdToCheck);
  if (!format.ok) {
    throw new FormatError(format.errors);
  }

  // Wrap the signer so each wallet signature advances the publish gauge. `phase` is
  // updated before each on-chain stage; the wrapper reads it at sign time.
  let phase: PublishProgress["phase"] = "store";
  let signed = 0;
  const tx = onProgress
    ? trackSignatures(signer, () => { signed += 1; onProgress({ phase, signed, kind: "skill" }); })
    : signer;

  await ensureDbRoot(tx);

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
    ...(input.image ? { image: input.image } : {}), // §3 — omit when absent
    attributes,
    skillText: input.text,
  });
  phase = "store";
  const skillTxid = await codeIn(
    tx,
    skillJson,
    `${input.name}.json`,
    "application/json",
    onProgress ? (percent) => onProgress({ phase: "store", signed, percent, kind: "skill" }) : undefined,
  );

  // Pre-generate the mint → derive the gate PDA that will own the mint authority.
  const skillMintKp = Keypair.generate();
  const skillMint = skillMintKp.publicKey;
  const mintAuthority = itemMintAuthorityPda(skillMint);

  // The skills collection is required: the mint reserves member space for it and
  // publish_item enrolls the mint into it on-chain (PDA-signed).
  const collectionStr = getSkillsCollectionMint();
  if (!collectionStr) throw new Error("Skills collection mint is not configured");
  const collectionMint = new PublicKey(collectionStr);

  phase = "mint";
  if (onProgress) onProgress({ phase, signed, kind: "skill" });
  await createSkillMint(conn, tx, {
    name: input.name,
    symbol: input.name.substring(0, 8).toUpperCase(),
    uri: skillTxid, // points at the JSON above (traits live there, not on the mint)
    collectionMint,
    mintKeypair: skillMintKp,
    minterAuthority: mintAuthority, // gate PDA holds the mint authority
  });

  // Register the item config on-chain AND self-mint the first copy to the
  // creator. publish_item mints 1 into the creator's ATA (supply 0 -> 1), so that
  // ATA must exist first. A skill has NO prerequisites.
  const creator = new PublicKey(await signerAddress(signer));
  const creatorAta = getAssociatedTokenAddressSync(skillMint, creator, false, TOKEN_2022_PROGRAM_ID);
  const ataIx = createAssociatedTokenAccountInstruction(creator, creatorAta, creator, skillMint, TOKEN_2022_PROGRAM_ID);
  const ix = publishItemIx({
    creator,
    itemMint: skillMint,
    requiredSkills: [],
    price: input.price ?? DEFAULT_SKILL_PRICE_LAMPORTS,
    group: collectionMint, // skills collection — publish_item enrolls the mint
  });
  phase = "list";
  if (onProgress) onProgress({ phase, signed, kind: "skill" });
  await sendTx(conn, tx, [ataIx, ix]);

  return skillMint.toBase58();
}

export interface BuySkillInput {
  skillId: string; // skill mint address
  buyerWallet: string; // wallet buying the skill
  creatorWallet: string; // paid the price (read from the item config on-chain)
  // workflows only: prerequisite skill mints IN CONFIG ORDER. buy_item verifies the buyer
  // holds each (their ATA is passed as a remaining account). Empty/omitted = a plain skill.
  requiredSkills?: string[];
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
      // A workflow gates on its required skills: pass their mints (config order) so the
      // program can check the buyer's ATAs. A plain skill has none → empty.
      requiredSkills: (input.requiredSkills ?? []).map((m) => new PublicKey(m)),
    }),
  );
  return sendTx(conn, signer, ixs);
}
