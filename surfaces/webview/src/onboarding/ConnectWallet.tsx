// First screen when no runtime exists yet: connect a Solana wallet. Mirrors the web path
// of packages/core's onboarding.ts — detect installed providers (Phantom/Solflare/…),
// sign the FIXED SESSION_KEY_MESSAGE once (that signature derives the session key), and
// send {connectWallet, address, signature}. The store flips to chat on `walletConnected`.

import { useMemo, useState } from "react";
// Subpath import (not the barrel) — the core index drags in node-only modules that can't
// bundle for the browser. webWallet.ts is browser-safe (only @solana/web3.js + types).
import { SESSION_KEY_MESSAGE } from "@iqlabs-official/agent-sdk/account/webWallet";
import { useStore } from "../state/store";

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey?: { toString(): string } }>;
  signMessage(
    msg: Uint8Array,
    enc?: string,
  ): Promise<{ signature?: Uint8Array } | Uint8Array>;
}

// Most Solana wallets inject a provider on a well-known global and follow Phantom's
// connect()/signMessage() shape, so one path handles them all — we just label by which
// answered. window.solana is the de-facto standard slot, kept last as a catch-all.
function detectWallets(): { name: string; provider: SolanaProvider }[] {
  const w = window as unknown as Record<string, any>;
  const seen = new Set<SolanaProvider>();
  const found: { name: string; provider: SolanaProvider }[] = [];
  const add = (name: string, provider: unknown) => {
    const p = provider as SolanaProvider | undefined;
    if (!p || typeof p.signMessage !== "function" || seen.has(p)) return;
    seen.add(p);
    found.push({ name, provider: p });
  };
  add("Phantom", w.phantom?.solana);
  add("Solflare", w.solflare);
  add("Backpack", w.backpack);
  add("OKX", w.okxwallet?.solana);
  add(w.solana?.isPhantom ? "Phantom" : "Wallet", w.solana);
  return found;
}

export function ConnectWallet() {
  const { send } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const wallets = useMemo(detectWallets, []);

  async function connectWith(name: string, provider: SolanaProvider) {
    setBusy(name);
    try {
      const res = await provider.connect();
      const pk = res?.publicKey || provider.publicKey;
      const address = pk!.toString();
      // Off-chain signMessage over the fixed bytes — one prompt; reused per session.
      const signed = await provider.signMessage(
        new TextEncoder().encode(SESSION_KEY_MESSAGE),
        "utf8",
      );
      const signature = (signed as { signature?: Uint8Array }).signature ?? (signed as Uint8Array);
      send({ type: "connectWallet", address, signature: Array.from(signature) });
    } catch {
      send({ type: "toast", text: "Wallet connection cancelled." });
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold">AgentNet</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Connect a wallet to begin. One signature derives your session key.
        </p>
      </div>

      {wallets.length === 0 ? (
        <p className="max-w-xs text-center text-sm text-zinc-500">
          No Solana wallet detected. Install Phantom, Solflare, or Backpack and reload.
        </p>
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-2">
          {wallets.map(({ name, provider }) => (
            <button
              key={name}
              disabled={busy !== null}
              onClick={() => connectWith(name, provider)}
              className="rounded-lg bg-orange-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            >
              {busy === name ? `Connecting ${name}…` : `Connect ${name}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
