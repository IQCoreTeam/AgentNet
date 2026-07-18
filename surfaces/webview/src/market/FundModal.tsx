import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../state/store";
import { haptics } from "../haptics";

// Shown when a buy fails because the wallet is out of SOL (buyResult code
// "insufficient_funds"). Unlock-flow-v2 "Insufficient funds · Top up" frame: a terminal
// denied-panel with a BALANCE_CHECK meta line, flicker banner, Required/Balance rows, the
// wallet's own DEPOSIT_ADDRESS with [Copy], a how-to link, and an "I've Sent It · Recheck"
// button that re-reads the balance. Devnet swaps the how-to for the one-tap faucet.
// Copy rules: no emoji, no em-dash.
export function FundModal() {
  const { state, send, closeFund, requestAirdrop } = useStore();
  const network = state.rpcStatus?.network ?? "devnet";
  const isDevnet = network === "devnet";
  const sol = state.marketBalance != null ? (state.marketBalance / 1e9).toFixed(3) : null;
  const address = state.walletAddress ?? "";
  // The purchase that tripped this modal, when its detail is still open - gives the
  // Required row. Absent (agent-driven buy), the row is hidden rather than guessed.
  const requiredLamports = state.marketDetail?.card?.price;
  const requiredSol = requiredLamports && requiredLamports !== "0" ? (Number(requiredLamports) / 1e9).toFixed(3) : null;

  const [copied, setCopied] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  // The balance event answering our recheck clears the spinner state.
  const lastBalance = useRef(state.marketBalance);
  useEffect(() => {
    if (state.marketBalance !== lastBalance.current) {
      lastBalance.current = state.marketBalance;
      setRechecking(false);
    }
  }, [state.marketBalance]);

  function copyAddress() {
    haptics.tap();
    try {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(address);
      } else {
        const ta = document.createElement("textarea");
        ta.value = address;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* leave the address selectable */
    }
  }

  function recheck() {
    haptics.tap();
    setRechecking(true);
    send({ type: "getBalance" });
  }

  const shortAddr = address ? `${address.slice(0, 4)}...${address.slice(-14)}` : "";
  const rowStyle: CSSProperties = { color: "var(--an-fg)" };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-5">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={closeFund} aria-hidden="true" />
      <div
        className="an-bracket unlock-flicker relative w-full max-w-[300px] p-4 pb-5"
        style={{ border: "1px solid #1d3a26", "--ts": "12px", "--bk": "var(--an-bg-0)", "--tk": "#2f6b46" } as CSSProperties}
      >
        {/* terminal balance-check meta line */}
        <div className="an-term-mono flex items-center justify-between pb-3 text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
          <span>&gt;BALANCE_CHECK</span>
          <button onClick={closeFund} aria-label="Close" className="an-term-mono -m-1 p-1 font-bold active:opacity-70">[x]</button>
        </div>
        {/* green scanline banner, CRT-flickered in like Access Denied */}
        <div
          className="an-term-mono unlock-denied-in text-center text-[15px] font-extrabold uppercase tracking-[0.18em]"
          style={{
            backgroundColor: "var(--an-green)",
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.11) 0, rgba(0,0,0,0.11) 1px, transparent 1px, transparent 4px)",
            color: "var(--an-on-green)",
            padding: "9px 10px",
          }}
        >
          Insufficient Funds
        </div>

        <div className="an-term-mono mt-3.5 space-y-1.5 text-[11px] font-semibold uppercase tracking-wide">
          {requiredSol && (
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--an-fg-dim)" }}>Required</span>
              <span style={rowStyle}>{requiredSol} SOL</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span style={{ color: "var(--an-fg-dim)" }}>Balance</span>
            <span style={{ color: "var(--an-green)" }}>{sol != null ? `${sol} SOL` : "unknown"}</span>
          </div>
        </div>

        <p className="an-term-mono mb-2 mt-3.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--an-fg-dim)" }}>
          &gt;DEPOSIT_ADDRESS<span className="unlock-cursor">_</span>
        </p>
        <div className="flex gap-1.5">
          <span
            className="an-term-mono min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap p-2.5 text-[11px] font-semibold"
            style={{ border: "1px solid var(--an-line)", background: "var(--an-bg-1)", color: "var(--an-fg-dim)" }}
          >
            {shortAddr}
          </span>
          <button
            onClick={copyAddress}
            className="an-term-mono shrink-0 px-3 text-[10px] font-bold uppercase tracking-wide active:opacity-80"
            style={{ border: "1px solid var(--an-green-line)", background: "var(--an-green-dim)", color: "var(--an-green)" }}
          >
            {copied ? "[OK]" : "[Copy]"}
          </button>
        </div>

        {isDevnet ? (
          <button
            onClick={() => { haptics.tap(); requestAirdrop(); }}
            disabled={state.funding}
            className="an-term-mono mt-3 flex w-full items-center justify-between gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide active:opacity-80 disabled:opacity-50"
            style={{ border: "1px solid var(--an-line)", color: "var(--an-green)" }}
          >
            <span>&gt; {state.funding ? "Requesting_devnet_SOL..." : "Get_devnet_SOL"}</span>
          </button>
        ) : (
          <a
            href="https://www.coinbase.com/how-to-buy/solana"
            target="_blank"
            rel="noreferrer"
            className="an-term-mono mt-3 flex items-center justify-between gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide no-underline active:opacity-80"
            style={{ border: "1px solid var(--an-line)", color: "var(--an-green)" }}
          >
            <span>&gt; How_to_send_SOL_here</span>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
          </a>
        )}

        <p className="an-term-mono mt-2.5 text-[10px] leading-relaxed" style={{ color: "var(--an-fg-mute)" }}>
          {isDevnet
            ? "The public devnet faucet is rate-limited. If it fails, wait a moment and retry, or send SOL to this address."
            : "Buy SOL on an exchange and send it to this address, then recheck."}
        </p>

        <button onClick={recheck} disabled={rechecking} className="an-btn an-btn-green mt-3.5 w-full disabled:opacity-50">
          {rechecking ? "Rechecking..." : "I've Sent It · Recheck"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
