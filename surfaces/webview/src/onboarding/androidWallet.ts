// Bridge to the Android shell's native Solana Mobile Wallet Adapter (MWA) flow. Only the
// Android WebView injects `window.AgentNetWallet` (see WalletBridge.kt); in a desktop
// browser this is absent and the caller falls back to the extension-detect path. This is
// additive — it changes nothing on the web/vscode surfaces.
//
// The native side is fire-and-callback (a @JavascriptInterface can't be a long async
// call): we call AgentNetWallet.connect(...) which returns immediately and launches the
// wallet app; the answer arrives later via window.__onWalletResult. We wrap that into a
// Promise here, keyed by a request id so concurrent/stale callbacks don't cross.

// Same subpath import ConnectWallet.tsx uses — base58-encode the raw pubkey with the very
// @solana/web3.js the backend parses it back with, so the address string matches exactly.
import { pubkeyToAddress } from "@iqlabs-official/agent-sdk/account/webWallet";

// Shape the native bridge object exposes (JSON strings cross the boundary).
interface NativeWallet {
  connect(requestJson: string): void;
}
interface WalletResult {
  id: string;
  ok: boolean;
  pubkey?: number[];
  signature?: number[];
  error?: string;
  reason?: string;
}

declare global {
  interface Window {
    AgentNetWallet?: NativeWallet;
    __onWalletResult?: (resultJson: string) => void;
  }
}

// True only inside the Android shell, where the native bridge is injected.
export function isAndroidWallet(): boolean {
  return typeof window.AgentNetWallet?.connect === "function";
}

// id -> resolver for in-flight requests. The dispatcher is installed once.
const pending = new Map<string, { resolve: (v: { address: string; signature: number[] }) => void; reject: (e: Error) => void }>();
let installed = false;

function ensureDispatcher() {
  if (installed) return;
  installed = true;
  window.__onWalletResult = (resultJson: string) => {
    let r: WalletResult;
    try {
      r = JSON.parse(resultJson);
    } catch {
      return; // malformed — nothing we can route
    }
    const entry = pending.get(r.id);
    if (!entry) return;
    pending.delete(r.id);
    if (r.ok && r.pubkey && r.signature) {
      try {
        const address = pubkeyToAddress(Uint8Array.from(r.pubkey));
        entry.resolve({ address, signature: r.signature });
      } catch (e) {
        entry.reject(e instanceof Error ? e : new Error(String(e)));
      }
    } else {
      const err = new Error(r.error || "Wallet request failed.");
      (err as Error & { reason?: string }).reason = r.reason;
      entry.reject(err);
    }
  };
}

// Drive the native MWA flow: authorize a wallet and sign `message`, returning the base58
// address and the raw signature bytes (as number[], ready for {connectWallet, signature}).
export function connectAndroidWallet(
  message: string,
): Promise<{ address: string; signature: number[] }> {
  ensureDispatcher();
  const bridge = window.AgentNetWallet;
  if (!bridge) return Promise.reject(new Error("Native wallet bridge unavailable."));

  const id = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    // Safety net: if the native side never calls back (e.g. the wallet app is killed),
    // don't leave the button stuck on "Connecting…" forever.
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("Wallet request timed out."));
    }, 180_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    bridge.connect(JSON.stringify({ id, message }));
  });
}
