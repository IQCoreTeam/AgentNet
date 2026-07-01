// First screen when no runtime exists yet: connect a Solana wallet. Mirrors the web path
// of packages/core's onboarding.ts — detect installed providers (Phantom/Solflare/…),
// sign the FIXED SESSION_KEY_MESSAGE once (that signature derives the session key), and
// send {connectWallet, address, signature}. The store flips to chat on `walletConnected`.

import { useMemo, useState } from "react";
// Subpath import (not the barrel) — the core index drags in node-only modules that can't
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

// When no wallet app is installed, the connect button flips into a "get Phantom" link.
// Pick the store by platform: in the Android shell MainActivity's shouldOverrideUrlLoading
// turns this https URL into an external ACTION_VIEW (so the Play Store app opens), and a
// mobile browser opens its native store directly. (id app.phantom / App Store 1598432977.)
function phantomStore(): { label: string; url: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iPad|iPhone|iPod/i.test(ua)
    ? { label: "Go to App Store", url: "https://apps.apple.com/app/id1598432977" }
    : { label: "Go to Play Store", url: "https://play.google.com/store/apps/details?id=app.phantom" };
}

export function ConnectWallet() {
  const { send } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  // Android-only: MWA can't tell us a wallet is missing until we try, so we surface the
  // "install a wallet" guidance reactively once transact reports NoWalletFound.
  const [hint, setHint] = useState<string | null>(null);
  const wallets = useMemo(detectWallets, []);
  // Inside the Android shell there are no injected providers — the native MWA bridge is
  // the only path. Detect it once and, if present, show a single native connect button.
  const android = useMemo(isAndroidWallet, []);
  // The SILENT Keystore reconnect now runs earlier, off the Splash, while the store is in its
  // "restoring" phase (see store.tsx) — so by the time this signup screen renders, a returning
  // user has already been reconnected or the restore came back empty. This screen is purely the
  // manual connect path.

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

  // Android: hand off to the native MWA flow. It produces the same (address, signature)
  // shape, so the rest — session-key derivation, backend — is identical to the web path.
  async function connectAndroid() {
    // After a no-wallet result the button becomes "get Phantom": send them to the store,
    // then clear the hint so returning with a wallet installed shows Connect Wallet again
    // (and the guidance never lingers once a wallet exists).
    if (hint) {
      const { url } = phantomStore();
      setHint(null);
      window.location.href = url; // shell opens it externally (shouldOverrideUrlLoading)
      return;
    }
    setBusy("Wallet");
    try {
      const { address, signature } = await connectAndroidWallet(SESSION_KEY_MESSAGE);
      send({ type: "connectWallet", address, signature });
    } catch (e) {
      // The native bridge tags a missing wallet app as reason "NoWalletFound" (see
      // WalletBridge.kt). Guide the user to install one instead of mislabeling it a cancel.
      const reason = (e as Error & { reason?: string })?.reason;
      if (reason === "NoWalletFound") {
        setHint(
          "No Solana wallet app found. Install Phantom or Solflare from the Play Store, then tap Connect Wallet again.",
        );
      } else {
        send({ type: "toast", text: (e as Error)?.message || "Wallet connection cancelled." });
      }
      setBusy(null);
    }
  }

  return (
    <OnboardingShell
      title="Connect your wallet"
      subtitle="One signature derives your session key. Your keys stay in your wallet."
    >
      {android ? (
        // Android shell: one button drives the native wallet picker (Phantom/Solflare/…).
        <>
          <OnboardingButton disabled={busy !== null} onClick={connectAndroid}>
            {busy ? "Connecting…" : hint ? phantomStore().label : "Connect Wallet"}
          </OnboardingButton>
          {hint ? (
            <p className="text-center text-sm text-zinc-500">{hint}</p>
          ) : null}
        </>
      ) : wallets.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">
          No Solana wallet detected. Install Phantom, Solflare, or Backpack and reload.
        </p>
      ) : (
        wallets.map(({ name, provider }) => (
          <OnboardingButton
            key={name}
            disabled={busy !== null}
            onClick={() => connectWith(name, provider)}
          >
            {busy === name ? `Connecting ${name}…` : `Connect ${name}`}
          </OnboardingButton>
        ))
      )}
    </OnboardingShell>
  );
}
