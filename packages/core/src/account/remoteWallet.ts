// Build a Wallet from a REMOTE SIGNER over loopback HTTP, the out-of-process
// counterpart of keypairWallet (local Keypair) and webWallet (browser provider).
// The secret key lives behind a service the operator runs, typically a policy
// vault (spend caps, allowlists, approval queues); this process never sees it.
// Protocol, all JSON:
//
//   GET  {url}/pubkey            -> { "address": "<base58>" }
//   POST {url}/sign-transaction  { "transaction": "<base64>" }
//                                -> { "transaction": "<base64 signed>" }
//   POST {url}/sign-message      { "message": "<base64>" }
//                                -> { "signature": "<base64>" }   (optional)
//
// Auth: when the signer requires a shared secret (a token-guarded loopback
// bridge), AGENTNET_WALLET_REMOTE_TOKEN is sent as a standard
// `Authorization: Bearer <token>` header on every call. Unset means no header,
// for signers that bind an unguarded loopback port.
//
// sign-transaction serializes with requireAllSignatures:false so partial
// signatures already added by mint/minter keypairs survive the round trip,
// the same rule webWallet's provider path follows. sign-message is optional
// on purpose: a vault that signs transactions under policy but refuses raw
// messages answers non-200, the error here stays clean, and mcp-stdio already
// downgrades to marketplace-only when the vault band cannot open.

import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "../runtime/contract.js";

// Deadline on every signer call, the same shape as the read-path timeout fix: a
// hung or wedged signer process must fail this call with a clear error instead of
// stalling the spawn forever (there is no user watching a stdio server's fetch).
// A policy vault that queues human approvals should answer within this window or
// answer with a refusal; holding the socket open is not a protocol state.
const SIGNER_TIMEOUT_MS = 30_000;

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postJson(url: string, body: object, token?: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SIGNER_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface the signer's own refusal text (a policy vault says WHY it said no).
    let detail = text;
    try {
      detail = String((JSON.parse(text) as { error?: unknown }).error ?? text);
    } catch {
      // not JSON, keep the raw body
    }
    throw new Error(`remote signer refused (${res.status}): ${detail}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export async function remoteWallet(url: string, token?: string): Promise<{ wallet: Wallet; address: string }> {
  const base = url.replace(/\/+$/, "");
  const res = await fetch(`${base}/pubkey`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(SIGNER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`remote signer at ${base} did not answer /pubkey (${res.status})`);
  const { address } = (await res.json()) as { address?: string };
  if (!address) throw new Error(`remote signer at ${base} returned no address`);
  const publicKey = new PublicKey(address); // throws on a junk address, fail fast

  async function signOne<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const versioned = "version" in tx;
    const bytes = versioned
      ? (tx as VersionedTransaction).serialize()
      : (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false });
    const out = await postJson(`${base}/sign-transaction`, {
      transaction: Buffer.from(bytes).toString("base64"),
    }, token);
    const signed = Buffer.from(String(out.transaction ?? ""), "base64");
    if (signed.length === 0) throw new Error("remote signer returned no transaction");
    // Copy signatures back onto the caller's object, the way keypairWallet
    // mutates and returns the same tx.
    if (versioned) {
      (tx as VersionedTransaction).signatures = VersionedTransaction.deserialize(signed).signatures;
    } else {
      (tx as Transaction).signatures = Transaction.from(signed).signatures;
    }
    return tx;
  }

  const wallet: Wallet = {
    address,
    publicKey,
    async signMessage(msg) {
      const out = await postJson(`${base}/sign-message`, {
        message: Buffer.from(msg).toString("base64"),
      }, token);
      const signature = Buffer.from(String(out.signature ?? ""), "base64");
      if (signature.length === 0) throw new Error("remote signer returned no signature");
      return Uint8Array.from(signature);
    },
    signTransaction: signOne,
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) await signOne(tx);
      return txs;
    },
  };
  return { wallet, address };
}
