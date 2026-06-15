import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { getBalance } from "./balance.js";
import { TokenAccountNotFoundError } from "@solana/spl-token";
import * as splToken from "@solana/spl-token";

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  const { PublicKey } = await import("@solana/web3.js");
  return {
    ...actual,
    getAssociatedTokenAddressSync: vi.fn().mockReturnValue(new PublicKey("11111111111111111111111111111111")),
    getAccount: vi.fn(),
  };
});

describe("notes/balance", () => {
  let mockConn: any;

  beforeEach(() => {
    mockConn = {};
    vi.clearAllMocks();
  });

  it("should return the balance when account exists", async () => {
    vi.mocked(splToken.getAccount).mockResolvedValueOnce({ amount: 10n } as any);
    
    const balance = await getBalance(
      mockConn,
      new PublicKey("11111111111111111111111111111111"),
      new PublicKey("11111111111111111111111111111111")
    );
    
    expect(balance).toBe(10n);
  });

  it("should return 0n if account is not found", async () => {
    vi.mocked(splToken.getAccount).mockRejectedValueOnce(new TokenAccountNotFoundError());
    
    const balance = await getBalance(
      mockConn,
      new PublicKey("11111111111111111111111111111111"),
      new PublicKey("11111111111111111111111111111111")
    );
    
    expect(balance).toBe(0n);
  });

  it("should throw for other errors", async () => {
    vi.mocked(splToken.getAccount).mockRejectedValueOnce(new Error("RPC Error"));
    
    await expect(
      getBalance(
        mockConn,
        new PublicKey("11111111111111111111111111111111"),
        new PublicKey("11111111111111111111111111111111")
      )
    ).rejects.toThrow("RPC Error");
  });
});
