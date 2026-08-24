import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { postNote, readNotes, deleteNote, postAgentNote, readAgentNotes, readBlogFeed } from "./notes.js";
import * as chain from "../core/chain.js";
import * as holdings from "./holdings.js";

const AUTHOR = "11111111111111111111111111111111";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn().mockResolvedValue([{ id: "note1" }]),
  readRowsByPda: vi.fn().mockResolvedValue([]),
  writeRow: vi.fn().mockResolvedValue("mockWriteSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
  signerAddress: vi.fn().mockResolvedValue("11111111111111111111111111111111"),
  feedPda: vi.fn(() => ({ toBase58: () => "FeedAnchor1111111111111111111111111111111111" })),
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

  it("readAgentNotes merges blog + reviews tables, deduped by id, newest first", async () => {
    // Table split (issue #203): posts come from blog:agent, comments from
    // reviews:agent; a migrated post (same id in both) shows once.
    vi.mocked(chain.readRows).mockImplementation(async (hint: string) =>
      (hint.startsWith("blog:agent:")
        ? [
            { id: "p1", author: "agentX", timestamp: 300 },
            { id: "legacy1", author: "agentX", timestamp: 100 }, // migrated copy
          ]
        : [
            { id: "c1", author: "someoneElse", timestamp: 200 },
            { id: "legacy1", author: "agentX", timestamp: 100 }, // pre-split original
            { id: "r1", author: "agentX", timestamp: 400, meta: { parentId: "c1" } },
          ]) as any,
    );

    const all = await readAgentNotes("agentX");
    expect(all.map((n) => n.id)).toEqual(["r1", "p1", "c1", "legacy1"]); // sorted desc, no dupe

    // selfOnly = the blog view: the owner's POSTS only, replies excluded.
    const self = await readAgentNotes("agentX", { selfOnly: true });
    expect(self.map((n) => n.id)).toEqual(["p1", "legacy1"]);
  });
});

describe("notes/blog feed (issues #183/#203)", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {};
    signer = Keypair.generate();
    vi.clearAllMocks();
    vi.mocked(chain.signerAddress).mockResolvedValue(AUTHOR);
  });

  it("a blog post (top-level self-note) writes to blog:agent and mirrors into the feed anchor", async () => {
    await postAgentNote(mockConn as Connection, signer, { agentWallet: AUTHOR, text: "gm", title: "hello" });
    const [, hint, , mirrors] = vi.mocked(chain.writeRow).mock.calls[0];
    expect(hint).toBe(`blog:agent:${AUTHOR}`);
    expect(vi.mocked(chain.ensureTable).mock.calls[0][1]).toBe(`blog:agent:${AUTHOR}`);
    expect(mirrors).toHaveLength(1);
    expect(chain.feedPda).toHaveBeenCalledWith("feed:blog");
  });

  it("a self reply stays in reviews:agent (thread intact) and does not mirror", async () => {
    await postAgentNote(mockConn as Connection, signer, { agentWallet: AUTHOR, text: "re", parentId: "note:x" });
    const [, hint, , mirrors] = vi.mocked(chain.writeRow).mock.calls[0];
    expect(hint).toBe(`reviews:agent:${AUTHOR}`);
    expect(mirrors).toBeUndefined();
  });

  it("a comment on someone else's board stays in reviews:agent and does not mirror", async () => {
    vi.mocked(holdings.heldSkillCreators).mockResolvedValue(new Map([["m1", "OTHER"]]));
    await postAgentNote(mockConn as Connection, signer, { agentWallet: "OTHER", text: "nice" });
    const [, hint, , mirrors] = vi.mocked(chain.writeRow).mock.calls[0];
    expect(hint).toBe("reviews:agent:OTHER");
    expect(mirrors).toBeUndefined();
  });

  it("readBlogFeed passes the mirrored full rows through, drops junk, sorts newest first", async () => {
    const B = "22222222222222222222222222222222";
    vi.mocked(chain.readRowsByPda).mockResolvedValue([
      { id: `note:${AUTHOR}:1:a`, author: AUTHOR, text: "old", timestamp: 1, meta: { title: "t", image: "img" } },
      { id: `note:${B}:2:b`, author: B, text: "new", timestamp: 2 },
      { text: "no author, no id" },
    ] as any);
    const posts = await readBlogFeed();
    // Full notes, untruncated, in hand for the client's X-model clamp; the
    // preview projection and the on-open re-fetch are gone (zo's PR review).
    expect(posts.map((p) => p.text)).toEqual(["new", "old"]);
    expect(posts[1].title).toBe("t");
    expect(posts[1].image).toBe("img");
    expect(posts[1].isSelfNote).toBe(true);
  });

  it("readBlogFeed keeps long bodies whole and dedupes re-mirrored ids", async () => {
    const long = ("word ".repeat(60)).trim(); // 299 chars, would have been snipped before
    vi.mocked(chain.readRowsByPda).mockResolvedValue([
      { id: `note:${AUTHOR}:2:a`, author: AUTHOR, text: long, timestamp: 2 },
      { id: `note:${AUTHOR}:2:a`, author: AUTHOR, text: long, timestamp: 2 }, // migration re-mirror
    ] as any);
    const posts = await readBlogFeed();
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe(long);
  });

  it("readBlogFeed drops a mirrored row whose id does not embed its claimed author", async () => {
    const victim = "33333333333333333333333333333333";
    vi.mocked(chain.readRowsByPda).mockResolvedValue([
      { id: `note:${AUTHOR}:1:a`, author: victim, text: "forged", timestamp: 1 }, // spoofed author
      { id: `note:${victim}:2:b`, author: victim, text: "real", timestamp: 2 },
    ] as any);
    const posts = await readBlogFeed();
    expect(posts.map((p) => p.text)).toEqual(["real"]);
  });
});