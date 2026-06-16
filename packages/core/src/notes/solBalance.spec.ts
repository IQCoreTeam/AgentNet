import { describe, it, expect } from "vitest";
import { canAffordSkill, getSolBalance, TX_FEE_BUFFER_LAMPORTS } from "./solBalance.js";

// conn stub: getBalance returns native lamports for the OFF-mode funds gate (issue #21).
function connWith(lamports: number) {
  return { getBalance: async () => lamports } as any;
}

const PUBKEY = "Buyer11111111111111111111111111111111111111";

describe("notes/solBalance", () => {
  it("reads native SOL balance via conn.getBalance", async () => {
    expect(await getSolBalance(connWith(123456), PUBKEY)).toBe(123456);
  });

  it("affords when balance >= price + tx-fee buffer", async () => {
    const price = 1_000_000;
    expect(await canAffordSkill(connWith(price + TX_FEE_BUFFER_LAMPORTS), PUBKEY, price)).toBe(true);
  });

  it("does not afford when balance is short by less than the buffer", async () => {
    const price = 1_000_000;
    expect(await canAffordSkill(connWith(price + TX_FEE_BUFFER_LAMPORTS - 1), PUBKEY, price)).toBe(false);
  });

  it("does not afford an empty wallet", async () => {
    expect(await canAffordSkill(connWith(0), PUBKEY, 1_000_000)).toBe(false);
  });
});
