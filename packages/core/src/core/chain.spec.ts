import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { init, ensureDbRoot, createTable, writeRow, codeIn, signerAddress, tableExists, readCodeIn, readRows, inscriptionSigOf, itemMetadataUri } from "./chain.js";
import { readCodeIn as sdkReadCodeIn, readTableRows as sdkReadTableRows } from "@iqlabs-official/solana-sdk/reader";

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
      rpcEndpoint: "https://api.devnet.solana.com",
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

  describe("readCodeIn — gateway-first", () => {
    it("returns the gateway's /data result when the gateway responds OK", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: "from gateway", metadata: "{}" }),
      }));
      const r = await readCodeIn("sig123");
      expect(r).toEqual({ data: "from gateway", metadata: "{}" });
      expect(sdkReadCodeIn).not.toHaveBeenCalled(); // gateway hit → no RPC
      vi.unstubAllGlobals();
    });

    it("falls back to the SDK read when the gateway fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const r = await readCodeIn("sig123");
      expect(r).toEqual({ data: "mocked code", metadata: "{}" }); // the SDK mock
      expect(sdkReadCodeIn).toHaveBeenCalledWith("sig123");
      vi.unstubAllGlobals();
    });

    it("falls back to the SDK read when the gateway returns non-OK", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const r = await readCodeIn("sig123");
      expect(r).toEqual({ data: "mocked code", metadata: "{}" });
      expect(sdkReadCodeIn).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("readRows — gateway-first", () => {
    it("returns the gateway's /table/{pda}/rows result without an on-chain read", async () => {
      const rows = [{ id: "a", author: "w", __txSignature: "s1" }];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null }, // a real Response always has headers; the ETag read needs it
        json: async () => ({ rows, nextCursor: null }),
      }));
      const r = await readRows("reviews:agent:w", { limit: 100 });
      expect(r).toEqual(rows);
      expect(sdkReadTableRows).not.toHaveBeenCalled(); // gateway hit → no per-row RPC
      vi.unstubAllGlobals();
    });

    it("falls back to the SDK on-chain read when the gateway fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const r = await readRows("reviews:agent:w");
      expect(r).toEqual([]); // the sdk readTableRows mock
      expect(sdkReadTableRows).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("falls back to the SDK on-chain read when the gateway returns non-OK", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      const r = await readRows("reviews:agent:w");
      expect(r).toEqual([]);
      expect(sdkReadTableRows).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("follows nextCursor to gather up to `limit` rows, then stops", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, headers: { get: () => null }, json: async () => ({ rows: [{ id: "1" }, { id: "2" }], nextCursor: "cur1" }) })
        .mockResolvedValueOnce({ ok: true, headers: { get: () => null }, json: async () => ({ rows: [{ id: "3" }], nextCursor: null }) });
      vi.stubGlobal("fetch", fetchMock);
      const r = await readRows("reviews:agent:w", { limit: 5 });
      expect(r.map((x: any) => x.id)).toEqual(["1", "2", "3"]);
      expect(fetchMock).toHaveBeenCalledTimes(2); // paged once, then table exhausted
      const firstUrl = fetchMock.mock.calls[0][0] as string;
      const secondUrl = fetchMock.mock.calls[1][0] as string;
      expect(firstUrl).toContain("/rows?limit=5");
      expect(secondUrl).toContain("before=cur1"); // cursor threaded into page 2
      vi.unstubAllGlobals();
    });
  });

  describe("inscriptionSigOf / itemMetadataUri", () => {
    const SIG = "4K3z7cWH8QAxd74tK4ErtNv8ZL1k97yrAsm7SQJg4zPRya7DnbsxtmZwEgza4H34Z6QX9ewjqpmospXe3KQahruh";
    const MINT = "Es18ADJ4ZpKDojLtvNJEBGCaXpqxsmw2kG8ihS6TJC7U";

    it("passes a legacy bare signature through", () => {
      expect(inscriptionSigOf(SIG)).toBe(SIG);
    });

    it("extracts the sig from a gateway skill URL (last segment)", () => {
      expect(inscriptionSigOf(`https://gateway.iqlabs.dev/skill/${MINT}/${SIG}`)).toBe(SIG);
    });

    it("tolerates .png suffix, trailing slash and query", () => {
      expect(inscriptionSigOf(`https://gateway.iqlabs.dev/skill/${MINT}/${SIG}.png`)).toBe(SIG);
      expect(inscriptionSigOf(`https://gateway.iqlabs.dev/skill/${MINT}/${SIG}/`)).toBe(SIG);
      expect(inscriptionSigOf(`https://gateway.iqlabs.dev/skill/${MINT}/${SIG}?v=1`)).toBe(SIG);
    });

    it("rejects things that carry no signature", () => {
      expect(inscriptionSigOf("txid123")).toBeNull(); // too short
      expect(inscriptionSigOf(`https://gateway.iqlabs.dev/skill/${MINT}`)).toBeNull(); // mint tail, not a sig
      expect(inscriptionSigOf("")).toBeNull();
    });

    it("itemMetadataUri builds a URL whose tail round-trips through inscriptionSigOf", () => {
      const uri = itemMetadataUri(MINT, SIG);
      expect(uri.endsWith(`/skill/${MINT}/${SIG}`)).toBe(true);
      expect(inscriptionSigOf(uri)).toBe(SIG);
    });
  });
});
