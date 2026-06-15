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

export function ConnectWallet() {
  const { send } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const wallets = useMemo(detectWallets, []);
  // Inside the Android shell there are no injected providers — the native MWA bridge is
  // the only path. Detect it once and, if present, show a single native connect button.
  const android = useMemo(isAndroidWallet, []);

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
    setBusy("Wallet");
    try {
      const { address, signature } = await connectAndroidWallet(SESSION_KEY_MESSAGE);
      send({ type: "connectWallet", address, signature });
    } catch {
      send({ type: "toast", text: "Wallet connection cancelled." });
      setBusy(null);
    }
  }

  async function connectViaQR() {
    setBusy("QR");
    try {
      const SignClient = (await import("@walletconnect/sign-client")).default;
      const bs58 = (await import("bs58")).default;

      const client = await SignClient.init({
        projectId: "3fcc6b14d1b7473db311d1bfab721c0b", // standard public project ID
        metadata: {
          name: "AgentNet",
          description: "AgentNet Web Wallet Connection",
          url: window.location.origin,
          icons: [window.location.origin + "/favicon.ico"],
        },
      });

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          solana: {
            chains: ["solana:5ey2ja1KstPwMQRx7EokG2dfJksAGGPA"],
            methods: ["solana_signMessage", "solana_signTransaction"],
            events: [],
          },
        },
      });

      if (uri) {
        setQrUri(uri);
      }

      const session = await approval();
      const accounts = session.namespaces.solana.accounts;
      const address = accounts[0].split(":")[2];

      const msgBytes = new TextEncoder().encode(SESSION_KEY_MESSAGE);
      const response = await client.request<string | { signature: string }>({
        topic: session.topic,
        chainId: "solana:5ey2ja1KstPwMQRx7EokG2dfJksAGGPA",
        request: {
          method: "solana_signMessage",
          params: {
            message: bs58.encode(msgBytes),
            pubkey: address,
          },
        },
      });

      const signatureBytes = typeof response === "string" ? bs58.decode(response) : bs58.decode(response.signature);

      send({ type: "connectWallet", address, signature: Array.from(signatureBytes) });
    } catch (err) {
      console.error(err);
      send({ type: "toast", text: "Wallet connection failed or cancelled." });
      setQrUri(null);
      setBusy(null);
    }
  }

  if (qrUri) {
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`;
    return (
      <OnboardingShell
        title="Scan QR to login"
        subtitle="Scan this QR code with Phantom or Solflare on your phone to connect."
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginTop: "16px" }}>
          <img src={qrCodeUrl} alt="WalletConnect QR Code" style={{ padding: "10px", background: "white", borderRadius: "8px", width: "200px", height: "200px" }} />
          <p style={{ fontSize: "0.85em", opacity: 0.7, textAlign: "center" }}>Waiting for approval on your phone...</p>
          <OnboardingButton onClick={() => { setQrUri(null); setBusy(null); }}>
            Cancel
          </OnboardingButton>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      title="Connect your wallet"
      subtitle="One signature derives your session key. Your keys stay in your wallet."
    >
      {android ? (
        // Android shell: one button drives the native wallet picker (Phantom/Solflare/…).
        <OnboardingButton disabled={busy !== null} onClick={connectAndroid}>
          {busy ? "Connecting…" : "Connect Wallet"}
        </OnboardingButton>
      ) : wallets.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
          <p className="text-center text-sm text-zinc-500" style={{ marginBottom: "12px" }}>
            No Solana wallet detected. Install Phantom, Solflare, or Backpack and reload.
          </p>
          <OnboardingButton
            disabled={busy !== null}
            onClick={connectViaQR}
          >
            {busy === "QR" ? "Connecting via QR…" : "QR to login (Phone)"}
          </OnboardingButton>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
          {wallets.map(({ name, provider }) => (
            <OnboardingButton
              key={name}
              disabled={busy !== null}
              onClick={() => connectWith(name, provider)}
            >
              {busy === name ? `Connecting ${name}…` : `Connect ${name}`}
            </OnboardingButton>
          ))}
          <OnboardingButton
            disabled={busy !== null}
            onClick={connectViaQR}
          >
            {busy === "QR" ? "Connecting via QR…" : "QR to login (Phone)"}
          </OnboardingButton>
        </div>
      )}
    </OnboardingShell>
  );
}
