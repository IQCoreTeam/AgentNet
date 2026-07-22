// Token-2022 mint helpers. Creates non-transferable soulbound tokens.
//
// One mint per skill; supply = popularity (on-chain counter); uri = code-in txid.

import {
  SystemProgram,
  PublicKey,
  Transaction,
  Keypair,
  type Connection,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction,
  createInitializeNonTransferableMintInstruction,
  createInitializeMetadataPointerInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getTokenMetadata,
  AuthorityType,
  ExtensionType,
  getMintLen,
  LENGTH_SIZE,
  TYPE_SIZE,
} from "@solana/spl-token";
import {
  pack,
  createInitializeInstruction as createInitializeMetadataInstruction,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import { type SignerInput, type WalletSigner } from "@iqlabs-official/solana-sdk/utils";
import { signerAddress, readCodeIn, inscriptionSigOf } from "../core/chain.js";
import { resolveMinter, tryMinterPubkey } from "./minter.js";

import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// Traits (category/hashtags) do NOT live on the mint. They go in the code-in
// JSON's standard `attributes` (plans/onchain-format/skill-nft-json.md §4), so
// the mint carries only name/symbol/uri. A reader resolves `uri` → the code-in
// JSON to get both the skill body and its traits in one read.

interface MintConfig {
  name: string;
  symbol: string;
  uri: string; // code-in txid (IQLabs on-chain path) — TokenMetadata.uri
  /**
   * Protocol minter to receive mint authority (Path A). Defaults to the env
   * minter (AGENTNET_MINTER_PUBKEY / _SECRET). When null/unset, authority stays
   * with the creator and buy/unlock remain blocked.
   */
  minterAuthority?: PublicKey;
  collectionMint?: PublicKey; // new field for token group enrollment
  /**
   * Use this keypair for the mint (instead of a fresh random one). Pass it when
   * the caller needs the mint address BEFORE creation — e.g. to derive a PDA that
   * will be the mint authority (workflow gate). The caller co-signs.
   */
  mintKeypair?: Keypair;
}

/** A skill's resolved content: mint name/symbol/uri (on-chain) joined with the
 *  code-in JSON the `uri` points at (description, traits, body). One round-trip. */
export interface SkillMintMetadata {
  name: string;
  symbol: string;
  uri: string; // code-in txid
  description?: string;
  category?: string;
  hashtags?: string[];
  skillText?: string; // the SKILL.md body
  // workflows only: prerequisite skill mints, IN PUBLISH ORDER (= the on-chain config's
  // required_skills order). buy_item needs these to pass the buyer's skill ATAs.
  requiredSkills?: string[];
}

/** The standard NFT JSON shape stored via code-in (skill-nft-json.md §2). */
interface SkillJson {
  name?: string;
  image?: string;
  description?: string;
  attributes?: { trait_type: string; value: string }[];
  skillText?: string;
}

/** Pull category (single) + hashtags (repeated "skill" traits) out of the
 *  standard `attributes` array (§4). */
function traitsFromAttributes(attributes: SkillJson["attributes"]): {
  category?: string;
  hashtags?: string[];
} {
  if (!Array.isArray(attributes)) return {};
  let category: string | undefined;
  const hashtags: string[] = [];
  for (const a of attributes) {
    if (!a || typeof a.value !== "string") continue;
    if (a.trait_type === "category") category = a.value;
    else if (a.trait_type === "skill") hashtags.push(a.value);
  }
  return { category, hashtags: hashtags.length ? hashtags : undefined };
}

/**
 * Create a Token-2022 mint for a skill (skill-nft-structure.md §1/§2).
 *
 * Returns: mint address
 *
 * Extensions, all native Token-2022:
 *   - NonTransferable   → soulbound (§1)
 *   - MetadataPointer   → points at the mint itself (self-hosted metadata)
 *   - TokenMetadata     → name/symbol + uri = code-in txid (§2 "NFT uri =
 *                         IQLabs on-chain path"). NO traits on the mint — they
 *                         live in the code-in JSON's `attributes` (§4).
 *
 * A reader resolves `uri` → the code-in JSON for both the skill body and its
 * traits — no off-chain registry table (§2 "No skills registry table"), no
 * mint-side trait fields. Caller signs; mint authority = creator.
 *
 * ⚠️ KNOWN LIMITATION (buy flow): mint authority = creator here, but `buySkill`
 * has the buyer sign the mintTo. On-chain mintTo requires the mint authority's
 * signature, so a buyer cannot self-mint a creator-authored mint — the buy tx
 * fails unless the creator co-signs. Open design decision (custom program with a
 * PDA mint authority, a protocol minter keypair, or creator co-sign). Only the
 * mint step of buy is blocked; publish/search/reputation/notes/validation work.
 */
export async function createSkillMint(
  conn: Connection,
  signer: SignerInput,
  config: MintConfig,
): Promise<PublicKey> {
  const creator = await signerAddress(signer);
  const creatorPk = new PublicKey(creator);
  const mintKeypair = config.mintKeypair ?? Keypair.generate();
  const mint = mintKeypair.publicKey;

  // TokenMetadata payload: name/symbol/uri only. uri = code-in txid; traits live
  // in that code-in JSON's `attributes`, not on the mint (§4).
  const metadata: TokenMetadata = {
    mint,
    name: config.name,
    symbol: config.symbol,
    uri: config.uri,
    additionalMetadata: [],
  };

  // Enrolling into a collection needs the GroupMemberPointer + TokenGroupMember
  // extensions. We allocate the member space and init the pointer here, but the
  // actual TokenGroupMember stamp is done ON-CHAIN by publish_item (the gate
  // program's collection-authority PDA signs it) — no off-chain minter key needed.
  const minterPk = config.minterAuthority ?? tryMinterPubkey();

  const extensions = [ExtensionType.NonTransferable, ExtensionType.MetadataPointer];
  if (config.collectionMint) {
    extensions.push(ExtensionType.GroupMemberPointer);
  }

  const preInitMintLen = getMintLen(extensions);
  
  let groupMemberLen = 0;
  if (config.collectionMint) {
    const totalExtensions = [...extensions, ExtensionType.TokenGroupMember];
    groupMemberLen = getMintLen(totalExtensions) - preInitMintLen;
  }

  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await conn.getMinimumBalanceForRentExemption(preInitMintLen + metadataLen + groupMemberLen);

  const tx = new Transaction().add(
    // 1. Create the mint account (only base extension space; metadata and groupMember reallocs in)
    SystemProgram.createAccount({
      fromPubkey: creatorPk,
      newAccountPubkey: mint,
      lamports,
      space: preInitMintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. MetadataPointer → the mint itself holds its metadata
    createInitializeMetadataPointerInstruction(mint, creatorPk, mint, TOKEN_2022_PROGRAM_ID),
  );

  if (config.collectionMint) {
    // GroupMemberPointer is a pre-init extension → must come before initMint2.
    const { createInitializeGroupMemberPointerInstruction } = await import("@solana/spl-token");
    tx.add(
      createInitializeGroupMemberPointerInstruction(
        mint,
        creatorPk,
        mint, // memberAddress is the mint itself
        TOKEN_2022_PROGRAM_ID
      ),
    );
  }

  tx.add(
    // 3. NonTransferable extension (soulbound)
    createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID),
    // 4. Initialize the mint (0 decimals for soulbound items). MUST come before
    //    metadata init (the metadata program requires an initialized mint).
    createInitializeMint2Instruction(
      mint,
      0, // decimals
      creatorPk, // mint authority
      creatorPk, // freeze authority
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  // NOTE: the TokenGroupMember stamp is intentionally NOT initialized here. The
  // gate program's publish_item enrolls the mint into the official collection
  // on-chain (its collection-authority PDA signs InitializeMember), so the mint
  // leaves this tx with the member SPACE reserved + GroupMemberPointer set, and
  // becomes a real member at publish. This removes the off-chain minter key.

  tx.add(
    // 5. TokenMetadata: name/symbol/uri (uri = code-in txid)
    createInitializeMetadataInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: creatorPk,
      mint,
      mintAuthority: creatorPk,
      name: config.name,
      symbol: config.symbol,
      uri: config.uri,
    }),
  );

  // 6. Path A authority handoff: give MINT authority to the protocol minter so
  //    buyers can later mint via the minter's co-signature (Token-2022 mintTo
  //    needs the authority's sig).
  if (minterPk && !minterPk.equals(creatorPk)) {
    tx.add(
      createSetAuthorityInstruction(
        mint,
        creatorPk, // current mint authority
        AuthorityType.MintTokens,
        minterPk, // new mint authority = protocol minter
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Sign and send
  const signerFull = signer as any; // cast to access signing
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = creatorPk;

  if ("secretKey" in signerFull) {
    // Keypair-like
    tx.sign(signerFull, mintKeypair);
  } else if ("signTransaction" in signerFull) {
    // WalletSigner: mintKeypair partial-signs first, then wallet signs
    tx.partialSign(mintKeypair);
    const signed = await (signerFull as WalletSigner).signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    return mint;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });

  return mint;
}

/**
 * Read a skill's metadata — the §2 path back from NFT → content. Reads the
 * mint's name/symbol/uri, then resolves `uri` (a code-in txid) to the standard
 * NFT JSON for description, traits (from `attributes`), and the body (§4). One
 * round-trip gives everything. Returns null if the mint has no metadata.
 *
 * The code-in payload is expected to be JSON; if it isn't parseable (shouldn't
 * happen for skills published by this SDK) the trait/body fields are simply
 * absent rather than throwing.
 */
export async function readSkillMintMetadata(
  conn: Connection,
  skillMintAddr: string,
): Promise<SkillMintMetadata | null> {
  const md = await getTokenMetadata(
    conn,
    new PublicKey(skillMintAddr),
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  if (!md) return null;

  const base: SkillMintMetadata = { name: md.name, symbol: md.symbol, uri: md.uri };
  if (!md.uri) return base;
  const sig = inscriptionSigOf(md.uri);
  if (!sig) return base; // uri carries no inscription signature we recognise

  try {
    const { data } = await readCodeIn(sig);
    if (!data) return base;
    const json = JSON.parse(data) as SkillJson;
    const { category, hashtags } = traitsFromAttributes(json.attributes);
    // requiredSkill traits, in array order (publish order = on-chain config order).
    const requiredSkills = Array.isArray(json.attributes)
      ? json.attributes.filter((a) => a.trait_type === "requiredSkill").map((a) => a.value)
      : [];
    return { ...base, description: json.description, category, hashtags, skillText: json.skillText, requiredSkills: requiredSkills.length ? requiredSkills : undefined };
  } catch {
    return base; // uri unresolvable or payload not the expected JSON
  }
}

/**
 * Read a published skill's BODY text — the NFT→content round-trip. The body is
 * the `skillText` field of the code-in JSON the mint's `uri` points at.
 * Search/detail views use this to show the actual skill content.
 */
export async function readSkillText(
  conn: Connection,
  skillMintAddr: string,
): Promise<string | null> {
  const md = await readSkillMintMetadata(conn, skillMintAddr);
  return md?.skillText ?? null;
}

/**
 * Free-issue one skill token to a wallet (admin / airdrop path — no payment).
 * `buySkill` is the paid equivalent; this exists for issuing without a charge.
 *
 * Path A: mint authority is the protocol minter, so the minter co-signs the
 * mintTo. `signer` pays fees (and creates the recipient ATA). Increments supply
 * by 1; the token is NonTransferable so it stays in the recipient forever.
 */
export async function mintSkillToken(
  conn: Connection,
  signer: SignerInput,
  skillMintAddr: string,
  recipientWallet: string,
  minterOverride?: Keypair,
): Promise<string> {
  const payer = await signerAddress(signer);
  const payerPk = new PublicKey(payer);
  const mintPk = new PublicKey(skillMintAddr);
  const recipientPk = new PublicKey(recipientWallet);
  const minter = resolveMinter(minterOverride);

  // Get or create ATA for recipient
  const ata = getAssociatedTokenAddressSync(mintPk, recipientPk, false, TOKEN_2022_PROGRAM_ID);

  const tx = new Transaction();

  // Create ATA if it doesn't exist (returns null for missing accounts, never throws)
  const ataInfo = await conn.getAccountInfo(ata);
  if (ataInfo === null) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payerPk,
        ata,
        recipientPk,
        mintPk,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Mint 1 token to the ATA — authority = protocol minter (co-signs below).
  tx.add(
    createMintToInstruction(
      mintPk,
      ata,
      minter.publicKey, // mint authority
      1, // amount (1 token for soulbound)
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
    const signed = await (signerFull as WalletSigner).signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    return sig;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  return sig;
}

/**
 * Read live supply (popularity) from the on-chain mint account.
 *
 * The mint is the single source of truth for popularity — search/reputation
 * hydrate `supply` from here (the DAS scan snapshot doesn't carry live supply).
 */
export async function getMintSupply(
  conn: Connection,
  skillMintAddr: string,
): Promise<number> {
  try {
    const mint = await getMint(
      conn,
      new PublicKey(skillMintAddr),
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    return Number(mint.supply);
  } catch {
    return 0;
  }
}
