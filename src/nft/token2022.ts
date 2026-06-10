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
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  ExtensionType,
  getMintLen,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { type SignerInput, type WalletSigner } from "@iqlabs-official/solana-sdk/utils";
import { signerAddress } from "../core/chain.js";

const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ");

interface MintConfig {
  name: string;
  symbol: string;
  uri: string; // code-in txid (IQLabs on-chain path)
  category?: string; // e.g. "clean-code", "design"
  hashtags?: string[]; // e.g. ["refactoring", "testing"]
}

/**
 * Create a Token-2022 mint for a skill.
 *
 * Returns: mint address
 *
 * The mint is NonTransferable (soulbound). Metadata (uri, category, hashtags)
 * are stored in the NFT collection metadata off-chain or via code-in.
 * Caller must sign. Mint authority is the caller (creator).
 */
export async function createSkillMint(
  conn: Connection,
  signer: SignerInput,
  config: MintConfig,
): Promise<PublicKey> {
  const creator = await signerAddress(signer);
  const creatorPk = new PublicKey(creator);
  const mintKeypair = Keypair.generate();

  // Extensions: NonTransferable only (metadata handled separately via code-in)
  const extensions = [ExtensionType.NonTransferable];
  const mintLen = getMintLen(extensions);
  const lamports = await conn.getMinimumBalanceForRentExemption(mintLen);

  const tx = new Transaction().add(
    // 1. Create the mint account with extension space
    SystemProgram.createAccount({
      fromPubkey: creatorPk,
      newAccountPubkey: mintKeypair.publicKey,
      lamports,
      space: mintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Initialize NonTransferable extension (soulbound)
    createInitializeNonTransferableMintInstruction(mintKeypair.publicKey, TOKEN_2022_PROGRAM_ID),
    // 3. Initialize Mint (0 decimals for soulbound items)
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      0, // decimals
      creatorPk, // mint authority
      creatorPk, // freeze authority
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  // Sign and send
  const signerFull = signer as any; // cast to access signing
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = creatorPk;

  if ("secretKey" in signerFull) {
    // Keypair-like
    tx.sign(signerFull, mintKeypair);
  } else if ("signTransaction" in signerFull) {
    // WalletSigner
    tx.sign(mintKeypair);
    const signed = await (signerFull as WalletSigner).signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction(sig);
    return mintKeypair.publicKey;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });

  return mintKeypair.publicKey;
}

/**
 * Mint one skill token to a wallet (for purchase/equip).
 *
 * Increments supply by 1. Non-transferable — once minted, stays in that wallet forever.
 * Returns tx signature.
 */
export async function mintSkillToken(
  conn: Connection,
  signer: SignerInput,
  skillMintAddr: string,
  recipientWallet: string,
): Promise<string> {
  const creator = await signerAddress(signer);
  const creatorPk = new PublicKey(creator);
  const mintPk = new PublicKey(skillMintAddr);
  const recipientPk = new PublicKey(recipientWallet);

  // Get or create ATA for recipient
  const ata = getAssociatedTokenAddressSync(mintPk, recipientPk, false, TOKEN_2022_PROGRAM_ID);

  const tx = new Transaction();

  // Create ATA if it doesn't exist (returns null for missing accounts, never throws)
  const ataInfo = await conn.getAccountInfo(ata);
  if (ataInfo === null) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        creatorPk,
        ata,
        recipientPk,
        mintPk,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Mint 1 token to the ATA
  tx.add(
    createMintToInstruction(
      mintPk,
      ata,
      creatorPk, // mint authority
      1, // amount (1 token for soulbound)
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signerFull = signer as any;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = creatorPk;

  if ("secretKey" in signerFull) {
    tx.sign(signerFull);
  } else if ("signTransaction" in signerFull) {
    const signed = await (signerFull as WalletSigner).signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    return sig;
  }

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  return sig;
}
