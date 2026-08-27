import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { migrateBlogPosts } from "./migrate.js";
import * as chain from "../core/chain.js";
import { blogAgentHint, reviewsAgentHint } from "../core/seed.js";

const WALLET = "11111111111111111111111111111111";
const FEED = { toBase58: () => "FeedAnchor1111111111111111111111111111111111" };

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn().mockResolvedValue([]),
  writeRow: vi.fn().mockResolvedValue("mockWriteSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
  feedPda: vi.fn(() => ({ toBase58: () => "FeedAnchor1111111111111111111111111111111111" })),
}));

// Route readRows by hint so one mock serves both tables per wallet.
function tables(byHint: Record<string, unknown[]>) {
  vi.mocked(chain.readRows).mockImplementation(async (hint: string) => (byHint[hint] ?? []) as any);
}

describe("notes/migrate (issue #203 backfill)", () => {
  let signer: Keypair;

  beforeEach(() => {
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("rewrites top-level self-notes into blog:agent preserving id + timestamp, mirroring the feed", async () => {
    const post = { id: `note:${WALLET}:100:aa`, author: WALLET, text: "post", timestamp: 100, __txSignature: "sig" };
    tables({ [reviewsAgentHint(WALLET)]: [post] });

    const res = await migrateBlogPosts(signer, [WALLET]);

    expect(res).toEqual([{ wallet: WALLET, migrated: 1, skipped: 0 }]);
    expect(chain.ensureTable).toHaveBeenCalledWith(signer, blogAgentHint(WALLET), expect.any(Array), "id");
    const [, hint, rowJson, mirrors] = vi.mocked(chain.writeRow).mock.calls[0];
    expect(hint).toBe(blogAgentHint(WALLET));
    // The id (comment:blog key) and timestamp survive; read decorations do not.
    expect(JSON.parse(rowJson as string)).toEqual({ id: post.id, author: WALLET, text: "post", timestamp: 100 });
    expect((mirrors as any[])[0].toBase58()).toBe(FEED.toBase58());
    expect(chain.feedPda).toHaveBeenCalledWith("feed:blog");
  });

  it("leaves comments and thread replies behind in reviews:agent", async () => {
    tables({
      [reviewsAgentHint(WALLET)]: [
        { id: "c1", author: "someoneElse", text: "review", timestamp: 1 },
        { id: "r1", author: WALLET, text: "thanks", timestamp: 2, meta: { parentId: "c1" } },
      ],
    });

    const res = await migrateBlogPosts(signer, [WALLET]);

    expect(res).toEqual([{ wallet: WALLET, migrated: 0, skipped: 0 }]);
    expect(chain.writeRow).not.toHaveBeenCalled();
    expect(chain.ensureTable).not.toHaveBeenCalled();
  });

  it("is idempotent: skips posts whose id already sits in blog:agent", async () => {
    const moved = { id: `note:${WALLET}:1:aa`, author: WALLET, text: "old", timestamp: 1 };
    const fresh = { id: `note:${WALLET}:2:bb`, author: WALLET, text: "new", timestamp: 2 };
    tables({
      [reviewsAgentHint(WALLET)]: [moved, fresh],
      [blogAgentHint(WALLET)]: [moved],
    });

    const res = await migrateBlogPosts(signer, [WALLET]);

    expect(res).toEqual([{ wallet: WALLET, migrated: 1, skipped: 1 }]);
    expect(chain.writeRow).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(chain.writeRow).mock.calls[0][2] as string).id).toBe(fresh.id);
  });

  it("walks every given wallet and reports per-wallet counts", async () => {
    const W2 = "22222222222222222222222222222222";
    tables({
      [reviewsAgentHint(WALLET)]: [{ id: "p1", author: WALLET, text: "a", timestamp: 1 }],
      [reviewsAgentHint(W2)]: [],
    });

    const res = await migrateBlogPosts(signer, [WALLET, W2]);

    expect(res).toEqual([
      { wallet: WALLET, migrated: 1, skipped: 0 },
      { wallet: W2, migrated: 0, skipped: 0 },
    ]);
  });
});
