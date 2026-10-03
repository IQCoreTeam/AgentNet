// Local Solana keypair → Wallet, for CLI/VSCode (no web wallet here).
// Reads the keypair from a file path (default: the Solana CLI standard
// ~/.config/solana/id.json), or generates one if the path is empty. NEVER
// overwrites an existing file unless explicitly told to (overwrite: true),
// so a developer's real Solana key is safe.
//
// Web/mobile surfaces don't use this — they implement Wallet via Phantom etc.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { keypairWallet } from "./keypairWallet.js";
import { base58Decode } from "./base58.js";
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

/** The keypair-file text for a key: what `id.json` holds, what solana-keygen writes. */
export function keypairFileText(kp: Keypair): string {
  return JSON.stringify(Array.from(kp.secretKey));
}

// What a user pastes into the import box: our own export / a Solana CLI keypair file
// (JSON array), or the base58 secret key other wallets export. Keypair.fromSecretKey
// rejects anything that is not a 64-byte key whose public half matches.
export function parseSecretKey(text: string): Keypair {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste a secret key first.");
  try {
    return trimmed.startsWith("[")
      ? parseKeypairFile(trimmed)
      : Keypair.fromSecretKey(base58Decode(trimmed));
  } catch {
    throw new Error("That is not a Solana secret key. Expected a 64-number JSON array or a base58 string.");
  }
}

// The file is a plaintext ed25519 secret key, so it is written owner-only (0600) inside
// an owner-only directory (0700) — what solana-keygen does, and what the rest of our own
// secrets already get (rpc.ts writes the Helius token with mode 0o600, paths.ts creates
// dirs with 0o700). Without the modes these defaulted to 0644: every local account could
// read a wallet the app invites the user to fund. Only keys we write get the modes — an
// existing file's permissions are left to whoever created it.
async function saveKeypair(path: string, kp: Keypair): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, keypairFileText(kp), { mode: 0o600 });
}

/**
 * Read the keypair at `path` for the "export secret key" screen, as keypair-file text.
 * `expectAddress` guards against handing out a key that is not the connected wallet
 * (a stale or hand-edited file): the export must be the wallet the user is looking at.
 */
export async function exportKeypair(path: string, expectAddress: string): Promise<string> {
  const kp = parseKeypairFile(await readFile(path, "utf8"));
  if (kp.publicKey.toBase58() !== expectAddress) {
    throw new Error(`The keypair file at ${path} does not match the connected wallet.`);
  }
  return keypairFileText(kp);
}

/**
 * Adopt a pasted secret key as this device's local wallet: write it to `path` and return
 * the wallet. The same key already there is a no-op. A DIFFERENT existing key is moved
 * aside to `<path>.replaced-<time>` rather than overwritten, so an import that turns out
 * to be the wrong wallet can never destroy the one that held the funds.
 */
export async function importKeypair(path: string, secret: string): Promise<LoadResult & { replaced: string | null }> {
  const kp = parseSecretKey(secret);
  const address = kp.publicKey.toBase58();
  const state = await inspectKeypair(path);
  let replaced: string | null = null;
  if (state === "ok" && parseKeypairFile(await readFile(path, "utf8")).publicKey.toBase58() === address) {
    return { wallet: keypairWallet(kp), address, created: false, path, replaced }; // already this wallet
  }
  if (state !== "missing") {
    // ok-but-different, or invalid: moved aside, never silently clobbered
    replaced = `${path}.replaced-${Date.now()}`;
    await rename(path, replaced);
  }
  await saveKeypair(path, kp);
  return { wallet: keypairWallet(kp), address, created: false, path, replaced };
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

  // missing, or invalid+overwrite → generate and write.
  const kp = Keypair.generate();
  await saveKeypair(path, kp);
  return { wallet: keypairWallet(kp), address: kp.publicKey.toBase58(), created: true, path };
}

/** Convenience: load/create at the given (or default) path, return the result. */
export async function localWallet(path?: string): Promise<LoadResult> {
  return loadOrCreateWallet(path ?? solanaDefaultKeypairPath());
}
