// Local Solana keypair → Wallet, for CLI/VSCode (no web wallet here).
// Reads the keypair from a file path (default: the Solana CLI standard
// ~/.config/solana/id.json), or generates one if the path is empty. NEVER
// overwrites an existing file unless explicitly told to (overwrite: true),
// so a developer's real Solana key is safe.
//
// Web/mobile surfaces don't use this — they implement Wallet via Phantom etc.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { keypairWallet } from "./keypairWallet.js";
import type { Wallet } from "../runtime/contract.js";

/** The Solana CLI default keypair location. */
export function solanaDefaultKeypairPath(): string {
  return join(homedir(), ".config", "solana", "id.json");
}

export type WalletFileState = "ok" | "missing" | "invalid";

// Solana keypair files are a JSON array of the 64-byte secret key.
function parseKeypairFile(text: string): Keypair {
  const bytes = Uint8Array.from(JSON.parse(text) as number[]);
  return Keypair.fromSecretKey(bytes); // throws if length/format is wrong
}

/** Inspect a path so the UI can show "load / generate / fix". Never writes. */
export async function inspectKeypair(path: string): Promise<WalletFileState> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return "missing";
  }
  try {
    parseKeypairFile(text);
    return "ok";
  } catch {
    return "invalid";
  }
}

export interface LoadResult {
  wallet: Wallet;
  address: string;
  created: boolean; // true = a new keypair was generated and written to `path`
  path: string;
}

// Load the keypair at `path`, or generate one if missing.
//   missing → generate + write, created:true
//   ok      → load, created:false
//   invalid → throw (caller offers "use another path" / re-call with overwrite)
//   invalid + overwrite:true → generate + overwrite, created:true
export async function loadOrCreateWallet(
  path: string,
  opts: { overwrite?: boolean } = {},
): Promise<LoadResult> {
  const state = await inspectKeypair(path);

  if (state === "ok") {
    const kp = parseKeypairFile(await readFile(path, "utf8"));
    return { wallet: keypairWallet(kp), address: kp.publicKey.toBase58(), created: false, path };
  }

  if (state === "invalid" && !opts.overwrite) {
    throw new Error(
      `The file at ${path} is not a valid Solana keypair. Check the path, ` +
        `or pass overwrite:true to replace it with a new wallet.`,
    );
  }

  // missing, or invalid+overwrite → generate and write
  const kp = Keypair.generate();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(Array.from(kp.secretKey)));
  return { wallet: keypairWallet(kp), address: kp.publicKey.toBase58(), created: true, path };
}

/** Convenience: load/create at the given (or default) path, return the result. */
export async function localWallet(path?: string): Promise<LoadResult> {
  return loadOrCreateWallet(path ?? solanaDefaultKeypairPath());
}
