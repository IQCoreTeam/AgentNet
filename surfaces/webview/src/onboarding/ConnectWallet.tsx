// First step after the welcome: connect a Solana wallet - this is the agent's identity.
// Mirrors the web path of packages/core's onboarding.ts - detect installed providers
// (Phantom/Solflare/...), sign the FIXED SESSION_KEY_MESSAGE once (that signature derives
// the session key), and send {connectWallet, address, signature}. The store flips to the
// AI-connection step on `walletConnected`.

import { useMemo, useState } from "react";
// Subpath import (not the barrel) - the core index drags in node-only modules that can't
// bundle for the browser. webWallet.ts is browser-safe (only @solana/web3.js + types).
import { SESSION_KEY_MESSAGE } from "@iqlabs-official/agent-sdk/account/webWallet";
import { isAndroidWallet, connectAndroidWallet } from "./androidWallet";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
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
// connect()/signMessage() shape, so one path handles them all - we just label by which
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
  // Inside the Android shell there are no injected providers - the native MWA bridge is
  // the only path. Detect it once and, if present, show a single native connect button.
  const android = useMemo(isAndroidWallet, []);

  async function connectWith(name: string, provider: SolanaProvider) {
    setBusy(name);
    try {
      const res = await provider.connect();
      const pk = res?.publicKey || provider.publicKey;
      const address = pk!.toString();
      // Off-chain signMessage over the fixed bytes - one prompt; reused per session.
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

  // Android: hand off to the native MWA flow. It produces the same (address, signature)
  // shape, so the rest - session-key derivation, backend - is identical to the web path.
  async function connectAndroid() {
    setBusy("Wallet");
    try {
      const { address, signature } = await connectAndroidWallet(SESSION_KEY_MESSAGE);
      send({ type: "connectWallet", address, signature });
    } catch {
      send({ type: "toast", text: "Wallet connection cancelled." });
      setBusy(null);
    }
  }

  return (
    <OnboardingShell
      title="Connect your wallet"
      subtitle="This is your agent's identity. You'll sign one short message to continue."
    >
      <p className="text-center text-xs leading-relaxed text-zinc-500">
        Signing proves this agent is yours and unlocks encrypted session sync. Your keys
        never leave your wallet.
      </p>

      {android ? (
        // Android shell: one button drives the native wallet picker (Phantom/Solflare/...).
        <OnboardingButton disabled={busy !== null} onClick={connectAndroid}>
          {busy ? "Connecting..." : "Connect Wallet"}
        </OnboardingButton>
      ) : wallets.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">
          No Solana wallet found. Install Phantom, Solflare, or Backpack, then reload this
          page.
        </p>
      ) : (
        wallets.map(({ name, provider }) => (
          <OnboardingButton
            key={name}
            disabled={busy !== null}
            onClick={() => connectWith(name, provider)}
          >
            {busy === name ? `Connecting ${name}...` : `Connect ${name}`}
          </OnboardingButton>
        ))
      )}
    </OnboardingShell>
  );
}
