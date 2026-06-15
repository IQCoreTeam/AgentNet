import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "../runtime/contract.js";

export interface WalletTransport {
  connect(): Promise<{ uri: string; approved: Promise<{ address: string }> }>; // uri → QR
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
  signTransaction<T>(tx: T): Promise<T>;
  disconnect(): Promise<void>;
}

export function remoteWallet(t: WalletTransport, address: string): Wallet {
  return {
    address,
    publicKey: new PublicKey(address),
    async signMessage(msg: Uint8Array): Promise<Uint8Array> {
      return t.signMessage(msg);
    },
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      return t.signTransaction(tx);
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      const results: T[] = [];
      for (const tx of txs) {
        results.push(await t.signTransaction(tx));
      }
      return results;
    },
  };
}
