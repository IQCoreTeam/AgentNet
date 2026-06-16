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
import { AGENTNET_ROOT_ID, getGatewayUrl } from "./seed.js";
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

/**
 * Token/collection gate enforced on writes by the IQ contract. `gateType`
 * defaults to a Token gate (hold ≥ `amount` of `mint`); use the SDK's
 * GateType.Collection value for NFT-collection membership.
 */
export interface TableGate {
  mint: string; // token mint / collection the writer must hold
  amount?: number; // min amount (default 1)
  gateType?: number; // GateType.Token (0) | GateType.Collection (1)
}

interface TableOptions {
  writers?: string[];
  gate?: TableGate;
}

export async function createTable(
  signer: DomainSignerInput,
  hint: string,
  columns: string[],
  idColumn: string,
  options?: TableOptions,
): Promise<string | null> {
  const s = asSolana(signer);
  const writers = options?.writers?.map((w) => new PublicKey(w));
  const gate = options?.gate
    ? {
        mint: new PublicKey(options.gate.mint),
        amount: options.gate.amount ?? 1,
        gateType: options.gate.gateType,
      }
    : undefined;

  return sdkCreateTable(
    conn(),
    s,
    AGENTNET_ROOT_ID,
    hint,
    hint,
    columns,
    idColumn,
    [],
    gate as any,
    writers,
    hint,
  );
}

/**
 * Create the table for `hint` if it doesn't exist yet. No-op if already created.
 *
 * `writeRow` requires the table PDA to be initialized first (createTable is a
 * separate on-chain instruction), so every writer must ensure its table exists
 * before the first row — same lazy pattern as `ensureDbRoot`.
 *
 * Pass `options.gate` to have the IQ contract enforce token/collection holding
 * on every write (set at creation; the gate is fixed for the table's life).
 */
export async function ensureTable(
  signer: DomainSignerInput,
  hint: string,
  columns: string[],
  idColumn: string,
  options?: TableOptions,
): Promise<string | null> {
  if (await accountExists(tablePda(hint))) return null;
  return createTable(signer, hint, columns, idColumn, options);
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

// Read a code-in inscription by its tx signature. Tries the gateway's cached
// `/data/{sig}` first (network-matched via getGatewayUrl — the mainnet gateway
// can't resolve a devnet tx, so the URL must follow the network); on any failure
// OR an empty body, falls back to the SDK's direct RPC read — so it always
// resolves the same shape. The empty-body fallback matters: a wrong-network
// gateway answers 200 with {data:null}, which without the fallback would leave
// the skill body blank instead of reading it straight from chain.
export async function readCodeIn(txSig: string): Promise<{ data: string | null; metadata: string }> {
  try {
    const res = await fetch(`${getGatewayUrl()}/data/${txSig}`);
    if (res.ok) {
      const json = (await res.json()) as { data?: string | null; metadata?: string };
      if (json.data) return { data: json.data, metadata: json.metadata ?? "" };
      // 200 but no data → gateway couldn't resolve it (often a network mismatch);
      // fall through to the direct RPC read rather than returning a blank body.
    }
  } catch {
    // fall through to the SDK read
  }
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
