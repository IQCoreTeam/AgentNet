// Thin wrappers over solana-sdk (iqlabs). PDA derivation stays behind hints,
// and all chain operations go through these functions so that reads/writes/key
// logic never duplicates. Every module calls only this file, not solana-sdk directly.
//
// The `Connection` is held in module state, wired once by `init()` — no caller
// above this layer threads a connection anymore.

import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  getDbRootPda,
  getTablePda,
  initializeDbRootInstruction,
  createInstructionBuilder,
} from "@iqlabs-official/solana-sdk/contract";
import {
  readTableRows,
  readCodeIn as sdkReadCodeIn,
} from "@iqlabs-official/solana-sdk/reader";
import {
  toSeedBytes,
  type SignerInput,
  type WalletSigner,
} from "@iqlabs-official/solana-sdk/utils";
import {
  createTable as sdkCreateTable,
  writeRow as sdkWriteRow,
  codeIn as sdkCodeIn,
} from "@iqlabs-official/solana-sdk/writer";
import { AGENTNET_ROOT_ID } from "./seed.js";
import type { Row, ReadOptions, SignerInput as DomainSignerInput } from "./types.js";

/** DbRoot PDA for the `agentnet-root` namespace — derived once, reused everywhere. */
const DB_ROOT_SEED = toSeedBytes(AGENTNET_ROOT_ID);
const DB_ROOT = getDbRootPda(DB_ROOT_SEED);

let connection: Connection | null = null;

function conn(): Connection {
  if (!connection) {
    throw new Error("chain layer not initialized — call init({ connection })");
  }
  return connection;
}

function asSolana(signer: DomainSignerInput): SignerInput {
  return signer as SignerInput;
}

async function signTx(signer: SignerInput, tx: Transaction): Promise<Transaction> {
  const Keypair = (await import("@solana/web3.js")).Keypair;
  if (signer instanceof Keypair || "secretKey" in signer) {
    tx.partialSign(signer as any);
    return tx;
  }
  return (signer as WalletSigner).signTransaction(tx);
}

function tablePda(hint: string): PublicKey {
  return getTablePda(DB_ROOT, toSeedBytes(hint));
}

async function accountExists(pda: PublicKey): Promise<boolean> {
  return (await conn().getAccountInfo(pda)) !== null;
}

// ===== Public interface =====

export function init(rpcConnection: Connection): void {
  connection = rpcConnection;
}

export async function ensureDbRoot(signer: DomainSignerInput): Promise<string | null> {
  if (await accountExists(DB_ROOT)) return null;

  const s = asSolana(signer);
  const builder = createInstructionBuilder();
  const ix = initializeDbRootInstruction(
    builder,
    {
      db_root: DB_ROOT,
      signer: s.publicKey,
      system_program: SystemProgram.programId,
    },
    { db_root_id: DB_ROOT_SEED },
  );

  const tx = new Transaction().add(ix);
  const c = conn();
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = s.publicKey;
  const signed = await signTx(s, tx);
  const signature = await c.sendRawTransaction(signed.serialize());
  await c.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
  return signature;
}

export async function createTable(
  signer: DomainSignerInput,
  hint: string,
  columns: string[],
  idColumn: string,
  options?: { writers?: string[] },
): Promise<string | null> {
  const s = asSolana(signer);
  const writers = options?.writers?.map((w) => new PublicKey(w));

  return sdkCreateTable(
    conn(),
    s,
    AGENTNET_ROOT_ID,
    hint,
    hint,
    columns,
    idColumn,
    [],
    undefined,
    writers,
    hint,
  );
}

export async function writeRow(
  signer: DomainSignerInput,
  hint: string,
  rowJson: string,
): Promise<string> {
  return sdkWriteRow(conn(), asSolana(signer), AGENTNET_ROOT_ID, hint, rowJson);
}

export async function readRows(hint: string, options?: ReadOptions): Promise<Row[]> {
  const pda = tablePda(hint);
  return readTableRows(pda, options);
}

export async function readRowsByPda(pda: PublicKey, options?: ReadOptions): Promise<Row[]> {
  return readTableRows(pda, options);
}

export async function codeIn(
  signer: DomainSignerInput,
  data: string | string[],
  filename: string,
  filetype: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  return sdkCodeIn(
    { connection: conn(), signer: asSolana(signer) },
    data,
    filename,
    0,
    filetype,
    onProgress,
  );
}

export async function readCodeIn(txSig: string): Promise<{ data: string | null; metadata: string }> {
  return sdkReadCodeIn(txSig);
}

export async function tableExists(hint: string): Promise<boolean> {
  return accountExists(tablePda(hint));
}

export function getTablePdaRef(hint: string): PublicKey {
  return tablePda(hint);
}

export async function signerAddress(signer: DomainSignerInput): Promise<string> {
  return asSolana(signer).publicKey.toBase58();
}
