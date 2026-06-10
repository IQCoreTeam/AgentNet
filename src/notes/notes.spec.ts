import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { postNote, readNotes, deleteNote, postAgentNote, readAgentNotes } from "./notes.js";
import * as chain from "../core/chain.js";
import * as balance from "./balance.js";

const AUTHOR = "11111111111111111111111111111111";

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

  // ===== agent notes =====

  it("self-note: author == agentWallet writes without a balance check", async () => {
    const noteId = await postAgentNote(mockConn as any, signer, {
      agentWallet: AUTHOR, // signer is the owner → self-note
      text: "I built these",
    });

    expect(noteId).toContain(`note:${AUTHOR}:`);
    expect(chain.writeRow).toHaveBeenCalled();
    expect(balance.getBalance).not.toHaveBeenCalled(); // owner skips the gate
  });

  it("comment on agent: allowed when author holds one of the agent's skills", async () => {
    vi.mocked(balance.getBalance).mockResolvedValue(1n);
    const source = {
      listSkills: vi.fn().mockResolvedValue([
        { id: AUTHOR, creator: "agentWalletX" },
      ]),
    };

    const noteId = await postAgentNote(mockConn as any, signer, {
      agentWallet: "agentWalletX",
      text: "great agent",
      source,
    });

    expect(noteId).toContain(`note:${AUTHOR}:`);
    expect(chain.writeRow).toHaveBeenCalled();
  });

  it("comment on agent: rejected when author holds none of the agent's skills", async () => {
    vi.mocked(balance.getBalance).mockResolvedValue(0n);
    const source = {
      listSkills: vi.fn().mockResolvedValue([
        { id: AUTHOR, creator: "agentWalletX" },
      ]),
    };

    await expect(
      postAgentNote(mockConn as any, signer, {
        agentWallet: "agentWalletX",
        text: "spam",
        source,
      }),
    ).rejects.toThrow(/Must hold ≥1 of agentWalletX's skills/);
  });

  it("readAgentNotes selfOnly returns only the owner's posts, newest first", async () => {
    vi.mocked(chain.readRows).mockResolvedValue([
      { id: "n1", author: "agentX", timestamp: 100 },
      { id: "n2", author: "someoneElse", timestamp: 200 },
      { id: "n3", author: "agentX", timestamp: 300 },
    ] as any);

    const all = await readAgentNotes(mockConn as any, "agentX");
    expect(all.map((n) => n.id)).toEqual(["n3", "n2", "n1"]); // sorted desc

    const self = await readAgentNotes(mockConn as any, "agentX", { selfOnly: true });
    expect(self.map((n) => n.id)).toEqual(["n3", "n1"]);
  });
});
