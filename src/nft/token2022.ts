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
  createUpdateFieldInstruction,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import { type SignerInput, type WalletSigner } from "@iqlabs-official/solana-sdk/utils";
import { signerAddress, readCodeIn } from "../core/chain.js";
import { resolveMinter, tryMinterPubkey } from "./minter.js";

import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// additional_metadata field keys (skill-nft-structure.md §1 traits → search.md).
// Stored on-chain in the TokenMetadata extension so search can filter by trait
// and a skill's text resolves from the mint's `uri` (no registry table needed).
const FIELD_CATEGORY = "category";
const FIELD_HASHTAGS = "hashtags";

interface MintConfig {
  name: string;
  symbol: string;
  uri: string; // code-in txid (IQLabs on-chain path) — TokenMetadata.uri
  category?: string; // e.g. "clean-code", "design" — additional_metadata trait
  hashtags?: string[]; // e.g. ["refactoring", "testing"] — additional_metadata trait
  /**
   * Protocol minter to receive mint authority (Path A). Defaults to the env
   * minter (AGENTNET_MINTER_PUBKEY / _SECRET). When null/unset, authority stays
   * with the creator and buy/unlock remain blocked.
   */
  minterAuthority?: PublicKey;
  collectionMint?: PublicKey; // new field for token group enrollment
}

/** On-chain skill traits read back from the mint's TokenMetadata extension. */
export interface SkillMintMetadata {
  name: string;
  symbol: string;
  uri: string; // code-in txid → resolve skill text via readCodeIn
  category?: string;
  hashtags?: string[];
}

/**
 * Create a Token-2022 mint for a skill (skill-nft-structure.md §1/§2).
 *
 * Returns: mint address
 *
 * Extensions, all native Token-2022:
 *   - NonTransferable   → soulbound (§1)
 *   - MetadataPointer   → points at the mint itself (self-hosted metadata)
 *   - TokenMetadata     → uri = code-in txid (§2 "NFT uri = IQLabs on-chain
 *                         path"); category + hashtags as additional_metadata
 *                         traits (§1 → search.md trait filter)
 *
 * So the mint is self-describing: a reader resolves the skill text from
 * `uri` and filters by on-chain traits — no off-chain registry table (§2
 * "No skills registry table"). Caller signs; mint authority = creator.
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
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;

  // Build the TokenMetadata payload. uri = code-in txid; traits go in
  // additional_metadata so search can filter on-chain (added via updateField
  // below — additionalMetadata in the initialize ix is ignored by the program).
  const additionalMetadata: [string, string][] = [];
  if (config.category) additionalMetadata.push([FIELD_CATEGORY, config.category]);
  if (config.hashtags && config.hashtags.length > 0) {
    additionalMetadata.push([FIELD_HASHTAGS, JSON.stringify(config.hashtags)]);
  }
  const metadata: TokenMetadata = {
    mint,
    name: config.name,
    symbol: config.symbol,
    uri: config.uri,
    additionalMetadata,
  };

  // If enrolling into a collection, we need the GroupMemberPointer and TokenGroupMember extensions.
  // The member enrollment must be signed by the group's update authority (the protocol minter).
  const minter = config.collectionMint ? resolveMinter() : null;
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

  if (config.collectionMint && minter) {
    const { createInitializeMemberInstruction } = await import("@solana/spl-token-group");
    tx.add(
      createInitializeMemberInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        member: mint,
        memberMint: mint,
        memberMintAuthority: creatorPk,
        group: config.collectionMint,
        groupUpdateAuthority: minter.publicKey,
      })
    );
  }

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

  // 6. Write each trait (category, hashtags) as an additional_metadata field.
  for (const [field, value] of additionalMetadata) {
    tx.add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: creatorPk,
        field,
        value,
      }),
    );
  }

  // 7. Path A authority handoff: give MINT authority to the protocol minter so
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

  if (minter) {
    tx.partialSign(minter);
  }

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
 * Read a skill's on-chain metadata (uri + traits) from the mint's TokenMetadata
 * extension — the §2 path back from NFT → content. `uri` is the code-in txid;
 * pass it to `readCodeIn` to get the skill text. category/hashtags are the
 * search traits. Returns null if the mint has no metadata.
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

  const fields = new Map(md.additionalMetadata);
  const rawHashtags = fields.get(FIELD_HASHTAGS);
  let hashtags: string[] | undefined;
  if (rawHashtags) {
    try {
      const parsed = JSON.parse(rawHashtags);
      if (Array.isArray(parsed)) hashtags = parsed;
    } catch {
      // Stored malformed — surface nothing rather than crash the reader.
    }
  }

  return {
    name: md.name,
    symbol: md.symbol,
    uri: md.uri,
    category: fields.get(FIELD_CATEGORY),
    hashtags,
  };
}

/**
 * Read a published skill's BODY text — the full NFT→content round-trip
 * (skill-nft-structure.md §2). Joins the two halves that otherwise sit
 * disconnected: `readSkillMintMetadata` (mint → uri=txid) then `readCodeIn`
 * (txid → inscribed SKILL.md text). Returns null if the mint has no metadata
 * or the inscription can't be resolved.
 *
 * This is the "show me this NFT's letter" call — search/detail views use it to
 * surface the actual skill content, not just the indexed name/description.
 */
export async function readSkillText(
  conn: Connection,
  skillMintAddr: string,
): Promise<string | null> {
  const md = await readSkillMintMetadata(conn, skillMintAddr);
  if (!md?.uri) return null;
  const { data } = await readCodeIn(md.uri);
  return data;
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
