// Bridge to the Android shell's native Solana Mobile Wallet Adapter (MWA) flow. Only the
// Android WebView injects `window.AgentNetWallet` (see WalletBridge.kt); in a desktop
// browser this is absent and the caller falls back to the extension-detect path. This is
// additive — it changes nothing on the web/vscode surfaces.
//
// The native side is fire-and-callback (a @JavascriptInterface can't be a long async
// call): AgentNetWallet returns immediately and the answer arrives later via
// window.__onWalletResult. We key requests by id so concurrent/stale callbacks don't cross.

// Same subpath import ConnectWallet.tsx uses — base58-encode the raw pubkey with the very
// @solana/web3.js the backend parses it back with, so the address string matches exactly.
import { pubkeyToAddress } from "@iqlabs-official/agent-sdk/account/webWallet";

// Shape the native bridge object exposes (JSON strings cross the boundary).
interface NativeWallet {
  connect(requestJson: string): void;
  signTransaction(requestJson: string): void;
  // Silent reconnect from a Keystore-saved connect result (no wallet-app round-trip).
  // Optional: older shells without it → restoreAndroidWallet resolves null.
  restore?(requestJson: string): void;
  // Forget the saved credentials (explicit disconnect).
  forget?(): void;
}
interface WalletResult {
  id: string;
  ok: boolean;
  pubkey?: number[];
  signature?: number[];
  signedTx?: string;
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

const pending = new Map<string, { resolve: (r: WalletResult) => void; reject: (e: Error) => void }>();
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
    if (r.ok) {
      entry.resolve(r);
    } else {
      const err = new Error(r.error || "Wallet request failed.");
      (err as Error & { reason?: string }).reason = r.reason;
      entry.reject(err);
    }
  };
}

function callBridge(
  invoke: (requestJson: string) => void,
  payload: Record<string, unknown>,
): Promise<WalletResult> {
  ensureDispatcher();
  const id = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    // Safety net: if the native side never calls back (e.g. the wallet app is killed),
    // don't leave the caller hanging forever.
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("Wallet request timed out."));
    }, 180_000);
    pending.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    invoke(JSON.stringify({ id, ...payload }));
  });
}

// Drive the native MWA flow: authorize a wallet and sign `message`, returning the base58
// address and the raw signature bytes (as number[], ready for {connectWallet, signature}).
export function connectAndroidWallet(
  message: string,
): Promise<{ address: string; signature: number[] }> {
  const bridge = window.AgentNetWallet;
  if (!bridge) return Promise.reject(new Error("Native wallet bridge unavailable."));
  return callBridge((json) => bridge.connect(json), { message }).then((r) => {
    if (!r.pubkey || !r.signature) throw new Error("Wallet returned no signature.");
    return { address: pubkeyToAddress(Uint8Array.from(r.pubkey)), signature: r.signature };
  });
}

// Silent reconnect: ask the shell for a Keystore-saved connect result, WITHOUT launching the
// wallet app. Resolves the same {address, signature} as connectAndroidWallet, or null when
// nothing is saved (reason "NoCached") or the shell is too old to support it — caller then
// shows the normal Connect button.
export function restoreAndroidWallet(): Promise<{ address: string; signature: number[] } | null> {
  const bridge = window.AgentNetWallet;
  if (!bridge?.restore) return Promise.resolve(null);
  const invoke = bridge.restore.bind(bridge);
  return callBridge((json) => invoke(json), {}).then(
    (r) =>
      r.pubkey && r.signature
        ? { address: pubkeyToAddress(Uint8Array.from(r.pubkey)), signature: r.signature }
        : null,
    () => null, // NoCached / any error → fall back to a fresh connect
  );
}

// Forget the Keystore-saved credentials so we don't silently reconnect (explicit disconnect).
export function forgetAndroidWallet(): void {
  window.AgentNetWallet?.forget?.();
}

export function signAndroidTransaction(txBase64: string): Promise<string> {
  const bridge = window.AgentNetWallet;
  if (!bridge) return Promise.reject(new Error("Native wallet bridge unavailable."));
  return callBridge((json) => bridge.signTransaction(json), { tx: txBase64 }).then((r) => {
    if (!r.signedTx) throw new Error("Wallet returned no signed transaction.");
    return r.signedTx;
  });
}
