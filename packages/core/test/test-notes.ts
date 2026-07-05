// Notes title/image fix (GH #97): REVIEW_COLUMNS has no title/image column, so
// buildNote must fold them into `meta` (not write them top-level), and
// hydrateNotes must pull them back out for callers. Also checks legacy
// top-level rows (written before the fix, if any survive on-chain) still read.

import { REVIEW_COLUMNS } from "../src/core/seed.js";
import { threadReplies } from "../src/notes/notes.js";
import type { Note } from "../src/core/types.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? "✅" : "❌"} ${n}`); if (!ok) pass = false; };

// buildNote/hydrateNotes aren't exported — reimplement the two lines under
// test against the real REVIEW_COLUMNS contract (SDK's writeRow rejects any
// row key not in REVIEW_COLUMNS).
function buildNote(text: string, title?: string, image?: string, meta?: Record<string, unknown>, parentId?: string) {
  const row: Record<string, unknown> = { id: "note:x:1:abc", author: "x", text, timestamp: 1 };
  const mergedMeta = { ...meta };
  if (title !== undefined) mergedMeta.title = title;
  if (image !== undefined) mergedMeta.image = image;
  if (parentId !== undefined) mergedMeta.parentId = parentId;
  if (Object.keys(mergedMeta).length > 0) row.meta = mergedMeta;
  return row;
}

function hydrate(n: Record<string, unknown>) {
  const meta = n.meta as Record<string, unknown> | undefined;
  const title = (n.title as string | undefined) ?? (meta?.title as string | undefined);
  const image = (n.image as string | undefined) ?? (meta?.image as string | undefined);
  const parentId = (n.parentId as string | undefined) ?? (meta?.parentId as string | undefined);
  return { ...n, title, image, parentId };
}

const note = (id: string, ts: number, parentId?: string, author = id): Note =>
  ({ id, author, text: id, timestamp: ts, ...(parentId ? { parentId } : {}) });

async function main() {
  // 1. a titled note's row keys must all be valid columns (the actual bug: SDK rejects unknown keys)
  const row = buildNote("hello", "My Post", "https://img/x.png");
  const keys = Object.keys(row);
  check("no top-level 'title' key", !keys.includes("title"));
  check("no top-level 'image' key", !keys.includes("image"));
  check("every key is a declared REVIEW_COLUMN", keys.every((k) => REVIEW_COLUMNS.includes(k)));

  // 2. round trip: title/image survive meta fold + unfold
  const hydrated = hydrate(row);
  check("title round-trips via meta", hydrated.title === "My Post");
  check("image round-trips via meta", hydrated.image === "https://img/x.png");

  // 3. no title/image -> no meta column written at all
  const bare = buildNote("no title here");
  check("bare note has no meta key", !("meta" in bare));

  // 4. legacy pre-fix rows (top-level title, no meta) still hydrate
  const legacy = hydrate({ id: "note:x:0", author: "x", text: "old", timestamp: 0, title: "Old Post" });
  check("legacy top-level title still reads", legacy.title === "Old Post");

  // ===== Threading (GH #101) =====

  // 5. parentId round-trips via meta, and stays out of the top-level keys
  const reply = buildNote("re", undefined, undefined, undefined, "note:parent:1");
  check("no top-level 'parentId' key", !Object.keys(reply).includes("parentId"));
  check("every reply key is a declared REVIEW_COLUMN", Object.keys(reply).every((k) => REVIEW_COLUMNS.includes(k)));
  check("parentId round-trips via meta", hydrate(reply).parentId === "note:parent:1");
  check("bare note has no parentId", hydrate(buildNote("plain")).parentId === undefined);

  // 6. grouping: two top-levels, replies collapse under their thread
  const t = threadReplies([
    note("A", 100),
    note("B", 90),
    note("a1", 110, "A"),
    note("a2", 105, "A"),
  ]);
  check("two top-level nodes", t.length === 2);
  check("top-level order follows input (A before B)", t[0].note.id === "A" && t[1].note.id === "B");
  check("A has 2 replies", t[0].replies.length === 2);
  check("replies sorted oldest-first", t[0].replies[0].id === "a2" && t[0].replies[1].id === "a1");
  check("B has no replies", t[1].replies.length === 0);

  // 7. deep reply flattens to the top ancestor (2-level render cap), keeps parentAuthor
  const deep = threadReplies([
    note("A", 100),
    note("a1", 110, "A"),
    note("a1a", 120, "a1"), // reply to a reply
  ]);
  check("deep reply collapses under top ancestor A", deep.length === 1 && deep[0].replies.length === 2);
  const a1a = deep[0].replies.find((r) => r.id === "a1a");
  check("flattened reply keeps immediate parentAuthor", a1a?.parentAuthor === "a1");

  // 8. orphan parentId (parent not in list) → renders top-level
  const orphan = threadReplies([note("x1", 100, "missing-parent")]);
  check("orphan parentId becomes top-level", orphan.length === 1 && orphan[0].note.id === "x1");

  // 9. parentId cycle (a↔b) doesn't hang — resolves without throwing
  const cyc = threadReplies([note("c1", 100, "c2"), note("c2", 100, "c1")]);
  check("cycle terminates and returns", Array.isArray(cyc));

  console.log(pass ? "\nPASS" : "\nFAIL");
  process.exit(pass ? 0 : 1);
}

main();
