import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { postNote, readNotes, deleteNote } from "./notes.js";
import * as chain from "../core/chain.js";
import * as balance from "./balance.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn().mockResolvedValue([{ id: "note1" }]),
  writeRow: vi.fn().mockResolvedValue("mockWriteSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
  signerAddress: vi.fn().mockResolvedValue("11111111111111111111111111111111"),
}));

vi.mock("./balance.js", () => ({
  getBalance: vi.fn(),
}));

describe("notes/notes", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {};
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should post a note if balance is >= 1", async () => {
    vi.mocked(balance.getBalance).mockResolvedValue(1n);

    const noteId = await postNote(mockConn as any, signer, {
      skillId: "11111111111111111111111111111111",
      subject: "Test Note",
      text: "This is a test note",
    });

    expect(noteId).toContain("note:11111111111111111111111111111111:");
    expect(chain.writeRow).toHaveBeenCalled();
  });

  it("should throw if balance is < 1", async () => {
    vi.mocked(balance.getBalance).mockResolvedValue(0n);

    await expect(
      postNote(mockConn as any, signer, {
        skillId: "11111111111111111111111111111111",
        subject: "Test Note",
        text: "This is a test note",
      })
    ).rejects.toThrow(/Must own ≥1 skill token/);
  });

  it("should read notes", async () => {
    const notes = await readNotes(mockConn as any, "11111111111111111111111111111111");
    expect(notes.length).toBe(1);
    expect(notes[0].id).toBe("note1");
    expect(chain.readRows).toHaveBeenCalled();
  });

  it("should throw on deleteNote for now", async () => {
    await expect(deleteNote(mockConn as any, signer, "note1")).rejects.toThrow("not yet implemented");
  });
});
