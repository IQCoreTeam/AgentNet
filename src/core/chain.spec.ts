import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { init, ensureDbRoot, createTable, writeRow, codeIn, signerAddress, tableExists } from "./chain.js";

// Mock the solana-sdk modules
vi.mock("@iqlabs-official/solana-sdk/contract", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return {
    getDbRootPda: vi.fn().mockReturnValue(new PublicKey("11111111111111111111111111111111")),
    getTablePda: vi.fn().mockReturnValue(new PublicKey("11111111111111111111111111111111")),
    initializeDbRootInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createInstructionBuilder: vi.fn().mockReturnValue({}),
  };
});

vi.mock("@iqlabs-official/solana-sdk/reader", () => ({
  readTableRows: vi.fn().mockResolvedValue([]),
  readCodeIn: vi.fn().mockResolvedValue({ data: "mocked code", metadata: "{}" }),
}));

vi.mock("@iqlabs-official/solana-sdk/utils", () => ({
  toSeedBytes: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
}));

vi.mock("@iqlabs-official/solana-sdk/writer", () => ({
  createTable: vi.fn().mockResolvedValue("mockTxSigCreate"),
  writeRow: vi.fn().mockResolvedValue("mockTxSigWrite"),
  codeIn: vi.fn().mockResolvedValue("mockTxSigCodeIn"),
}));

describe("core/chain", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
      sendRawTransaction: vi.fn().mockResolvedValue("mockSig"),
      confirmTransaction: vi.fn().mockResolvedValue({}),
    };
    init(mockConn as any as Connection);
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should return null if dbRoot already exists", async () => {
    mockConn.getAccountInfo.mockResolvedValueOnce({ data: new Uint8Array() });
    const sig = await ensureDbRoot(signer);
    expect(sig).toBeNull();
  });

  it("should initialize dbRoot if it does not exist", async () => {
    const sig = await ensureDbRoot(signer);
    expect(sig).toBe("mockSig");
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  it("should call createTable from solana-sdk writer", async () => {
    const sig = await createTable(signer, "hint", ["col1"], "col1", { writers: [signer.publicKey.toBase58()] });
    expect(sig).toBe("mockTxSigCreate");
  });

  it("should call writeRow from solana-sdk writer", async () => {
    const sig = await writeRow(signer, "hint", '{"foo":"bar"}');
    expect(sig).toBe("mockTxSigWrite");
  });

  it("should call codeIn from solana-sdk writer", async () => {
    const sig = await codeIn(signer, "hello world", "test.md", "text/markdown");
    expect(sig).toBe("mockTxSigCodeIn");
  });

  it("should return false if table does not exist", async () => {
    mockConn.getAccountInfo.mockResolvedValueOnce(null);
    expect(await tableExists("non-existent")).toBe(false);
  });

  it("should return true if table exists", async () => {
    mockConn.getAccountInfo.mockResolvedValueOnce({ data: new Uint8Array() });
    expect(await tableExists("existing")).toBe(true);
  });

  it("should get correct signer address", async () => {
    expect(await signerAddress(signer)).toBe(signer.publicKey.toBase58());
  });
});
