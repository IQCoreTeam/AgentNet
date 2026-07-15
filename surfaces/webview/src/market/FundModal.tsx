import { createPortal } from "react-dom";
import { useStore } from "../state/store";
import { haptics } from "../haptics";

// Shown when a buy fails because the wallet is out of SOL (buyResult code
// "insufficient_funds"). On devnet it offers a one-tap faucet grant (Get devnet SOL) and
// refreshes the balance so the buyer can retry; on mainnet there is no faucet, so it just
// explains how to add funds. Copy rules: no emoji, no em-dash.
export function FundModal() {
  const { state, closeFund, requestAirdrop } = useStore();
  const network = state.rpcStatus?.network ?? "devnet";
  const isDevnet = network === "devnet";
  const sol = state.marketBalance != null ? (state.marketBalance / 1e9).toFixed(3) : null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={closeFund} aria-hidden="true" />
      <div
        className="unlock-flicker relative flex w-full flex-col overflow-hidden rounded-t-2xl border sm:max-w-md sm:rounded-2xl"
        style={{ background: "var(--an-bg-1)", borderColor: "var(--an-line)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3.5" style={{ borderColor: "var(--an-line)" }}>
          <h2 className="an-term-title text-[14px]" style={{ letterSpacing: "1px" }}>Add funds</h2>
          <button onClick={closeFund} aria-label="Close" className="-mr-1 p-1.5 active:opacity-70" style={{ color: "var(--an-fg-mute)" }}>
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <p className="text-sm" style={{ color: "var(--an-fg)" }}>
            {isDevnet
              ? "This wallet does not have enough SOL on devnet to cover the purchase and the network fee."
              : "This wallet does not have enough SOL to cover the purchase and the network fee."}
          </p>
          <p className="mt-2 text-[12px]" style={{ color: "var(--an-fg-dim)" }}>
            Balance: {sol != null ? `${sol} SOL` : "unknown"} on {network}.
          </p>

          {isDevnet ? (
            <button
              onClick={() => { haptics.tap(); requestAirdrop(); }}
              disabled={state.funding}
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold active:opacity-80 disabled:opacity-60"
              style={{ background: "var(--an-green)", color: "var(--an-on-green)" }}
            >
              {state.funding ? "Requesting devnet SOL..." : "Get devnet SOL"}
            </button>
          ) : (
            <p className="mt-4 text-[12px]" style={{ color: "var(--an-fg-dim)" }}>
              Send SOL to this wallet from an exchange or another wallet, then try the purchase again.
            </p>
          )}

          <button
            onClick={closeFund}
            className="mt-2 w-full rounded-xl py-3 text-sm active:opacity-80"
            style={{ background: "var(--an-bg-2)", color: "var(--an-fg-dim)" }}
          >
            Close
          </button>

          {isDevnet && (
            <p className="mt-3 text-[11px]" style={{ color: "var(--an-fg-mute)" }}>
              The public devnet faucet is rate-limited. If this fails, wait a moment and try again, or add a Helius key in Market RPC settings.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
