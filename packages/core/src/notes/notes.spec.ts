import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { postNote, readNotes, deleteNote, postAgentNote, readAgentNotes } from "./notes.js";
import * as chain from "../core/chain.js";
import * as holdings from "./holdings.js";

const AUTHOR = "11111111111111111111111111111111";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn().mockResolvedValue([{ id: "note1" }]),
  writeRow: vi.fn().mockResolvedValue("mockWriteSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
  signerAddress: vi.fn().mockResolvedValue("11111111111111111111111111111111"),
}));

vi.mock("./holdings.js", () => ({
  heldSkillMints: vi.fn(),
  heldSkillCreators: vi.fn(),
}));

describe("notes/notes", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {};
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should post a note if the author holds the skill mint", async () => {
    vi.mocked(holdings.heldSkillMints).mockResolvedValue(new Set(["11111111111111111111111111111111"]));

    const noteId = await postNote(mockConn as any, signer, {
      collectionId: "SkillsCollection",
      skillId: "11111111111111111111111111111111",
      text: "This is a test note",
    });

    expect(noteId).toContain("note:11111111111111111111111111111111:");
    expect(chain.writeRow).toHaveBeenCalled();
  });

  it("writes a trimmed row: no subject/isSelfNote, optional meta included", async () => {
    vi.mocked(holdings.heldSkillMints).mockResolvedValue(new Set(["11111111111111111111111111111111"]));

    await postNote(mockConn as any, signer, {
      collectionId: "SkillsCollection",
      skillId: "11111111111111111111111111111111",
      text: "hi",
      meta: { tag: "v1" },
    });

    const rowJson = vi.mocked(chain.writeRow).mock.calls[0][2] as string;
    const row = JSON.parse(rowJson);
    expect(row).not.toHaveProperty("subject"); // table key, not stored
    expect(row).not.toHaveProperty("isSelfNote"); // derived on read
    expect(row.meta).toEqual({ tag: "v1" });
    expect(row).toHaveProperty("text", "hi");
  });

  it("should throw if the author does not hold the skill mint", async () => {
    vi.mocked(holdings.heldSkillMints).mockResolvedValue(new Set<string>());

    await expect(
      postNote(mockConn as any, signer, {
        collectionId: "SkillsCollection",
        skillId: "11111111111111111111111111111111",
        text: "This is a test note",
      })
    ).rejects.toThrow(/Must own ≥1 skill token/);
  });

  it("should read notes and derive subject + isSelfNote", async () => {
    const skillId = "11111111111111111111111111111111";
    vi.mocked(chain.readRows).mockResolvedValueOnce([
      { id: "note1", author: "someBuyer", text: "great", timestamp: 1 },
    ] as any);

    const notes = await readNotes("SkillsCollection", skillId);
    expect(notes.length).toBe(1);
    expect(notes[0].id).toBe("note1");
    expect(notes[0].subject).toBe(skillId); // derived from the table key
    expect(notes[0].isSelfNote).toBe(false); // author != subject
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
    expect(holdings.heldSkillCreators).not.toHaveBeenCalled(); // owner skips the gate
  });

  it("comment on agent: allowed when the author holds a skill CREATED BY that agent", async () => {
    // On-chain ground truth: a held skill mint whose creator is the agent. (Not the
    // indexer's listSkills — that catalog under-reports and falsely blocked holders.)
    vi.mocked(holdings.heldSkillCreators).mockResolvedValue(
      new Map([["someSkillMint", "agentWalletX"]]),
    );

    const noteId = await postAgentNote(mockConn as any, signer, {
      agentWallet: "agentWalletX",
      text: "great agent",
    });

    expect(noteId).toContain(`note:${AUTHOR}:`);
    expect(chain.writeRow).toHaveBeenCalled();
  });

  it("comment on agent: rejected when the author holds no skill created by that agent", async () => {
    // The author holds skills, but all created by someone else → gate rejects.
    vi.mocked(holdings.heldSkillCreators).mockResolvedValue(
      new Map([["otherSkillMint", "someoneElse"]]),
    );

    await expect(
      postAgentNote(mockConn as any, signer, {
        agentWallet: "agentWalletX",
        text: "spam",
      }),
    ).rejects.toThrow(/Must hold ≥1 of agentWalletX's skills/);
  });

  it("readAgentNotes selfOnly returns only the owner's posts, newest first", async () => {
    vi.mocked(chain.readRows).mockResolvedValue([
      { id: "n1", author: "agentX", timestamp: 100 },
      { id: "n2", author: "someoneElse", timestamp: 200 },
      { id: "n3", author: "agentX", timestamp: 300 },
    ] as any);

    const all = await readAgentNotes("agentX");
    expect(all.map((n) => n.id)).toEqual(["n3", "n2", "n1"]); // sorted desc

    const self = await readAgentNotes("agentX", { selfOnly: true });
    expect(self.map((n) => n.id)).toEqual(["n3", "n1"]);
  });
});
