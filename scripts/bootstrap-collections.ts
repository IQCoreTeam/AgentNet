import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  ExtensionType,
  createInitializeMint2Instruction,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
  createInitializeGroupPointerInstruction,
} from "@solana/spl-token";
import {
  createInitializeGroupInstruction,
} from "@solana/spl-token-group";
import { tryMinterPubkey } from "../src/nft/minter.js";

/**
 * Bootstraps the TokenGroup collections for AgentNet.
 * Usage:
 *  export SOLANA_RPC_URL="..."
 *  export PAYER_SECRET="..." (JSON array format)
 *  export AGENTNET_MINTER_PUBKEY="..."   (or AGENTNET_MINTER_SECRET)
 *  npx tsx scripts/bootstrap-collections.ts
 *
 * The group UPDATE AUTHORITY is set to the protocol minter — enrollment
 * (createSkillMint) passes the minter as `groupUpdateAuthority` and the minter
 * co-signs each member add, so the group's stored update authority MUST match
 * the minter or every enrollment fails on-chain ("incorrect update authority").
 */
async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const conn = new Connection(rpcUrl, "confirmed");

  const secretRaw = process.env.PAYER_SECRET;
  if (!secretRaw) {
    throw new Error("Please set PAYER_SECRET as a JSON array");
  }
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretRaw)));

  // The minter must be the group's update authority (it co-signs every member
  // enrollment). Resolve it the same way createSkillMint does.
  const minterPk = tryMinterPubkey();
  if (!minterPk) {
    throw new Error(
      "Set AGENTNET_MINTER_PUBKEY (or AGENTNET_MINTER_SECRET) — the group update authority must equal the enrollment minter.",
    );
  }

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Group update authority (minter):", minterPk.toBase58());

  async function createCollectionMint(maxSize: number): Promise<PublicKey> {
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    // Phase 1: Pre-init extensions
    const preInitExtensions = [ExtensionType.GroupPointer];
    const preInitMintLen = getMintLen(preInitExtensions);
    const preInitLamports = await conn.getMinimumBalanceForRentExemption(preInitMintLen);

    // Phase 2: Total size including post-init extensions
    const totalExtensions = [ExtensionType.GroupPointer, ExtensionType.TokenGroup];
    const totalMintLen = getMintLen(totalExtensions);
    const totalLamports = await conn.getMinimumBalanceForRentExemption(totalMintLen);
    const postInitLamports = totalLamports - preInitLamports;

    const tx = new Transaction().add(
      // 1. Create account with pre-init space
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        lamports: preInitLamports,
        space: preInitMintLen,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      // 2. Init GroupPointer (pre-init)
      createInitializeGroupPointerInstruction(
        mint,
        payer.publicKey, // authority
        mint, // groupAddress = the mint itself
        TOKEN_2022_PROGRAM_ID
      ),
      // 3. Init Mint
      createInitializeMint2Instruction(
        mint,
        0, // decimals
        payer.publicKey, // mintAuthority
        payer.publicKey, // freezeAuthority
        TOKEN_2022_PROGRAM_ID
      ),
      // 4. Transfer rent for TokenGroup (post-init)
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: mint,
        lamports: postInitLamports > 0 ? postInitLamports : 0,
      }),
      // 5. Init TokenGroup (post-init; reallocates internally)
      createInitializeGroupInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        group: mint,
        mint: mint,
        mintAuthority: payer.publicKey, // payer signs group init (it owns the mint)
        updateAuthority: minterPk, // MUST equal the enrollment minter (see header)
        maxSize: BigInt(maxSize),
      })
    );

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer, mintKeypair);

    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });

    return mint;
  }

  console.log("Creating Skills Collection...");
  const skillsCollection = await createCollectionMint(1000000);
  console.log("SKILLS_COLLECTION_MINT =", skillsCollection.toBase58());

  console.log("Creating Workflows Collection...");
  const workflowsCollection = await createCollectionMint(1000000);
  console.log("WORKFLOWS_COLLECTION_MINT =", workflowsCollection.toBase58());

  console.log("\nAdd these to your environment variables:");
  console.log(`export AGENTNET_SKILLS_COLLECTION_PUBKEY="${skillsCollection.toBase58()}"`);
  console.log(`export AGENTNET_WORKFLOWS_COLLECTION_PUBKEY="${workflowsCollection.toBase58()}"`);
}

main().catch(console.error);
