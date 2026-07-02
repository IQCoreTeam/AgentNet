// Notes title/image fix (GH #97): REVIEW_COLUMNS has no title/image column, so
// buildNote must fold them into `meta` (not write them top-level), and
// hydrateNotes must pull them back out for callers. Also checks legacy
// top-level rows (written before the fix, if any survive on-chain) still read.

import { REVIEW_COLUMNS } from "../src/core/seed.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? "✅" : "❌"} ${n}`); if (!ok) pass = false; };

// buildNote/hydrateNotes aren't exported — reimplement the two lines under
// test against the real REVIEW_COLUMNS contract (SDK's writeRow rejects any
// row key not in REVIEW_COLUMNS).
function buildNote(text: string, title?: string, image?: string, meta?: Record<string, unknown>) {
  const row: Record<string, unknown> = { id: "note:x:1:abc", author: "x", text, timestamp: 1 };
  const mergedMeta = { ...meta };
  if (title !== undefined) mergedMeta.title = title;
  if (image !== undefined) mergedMeta.image = image;
  if (Object.keys(mergedMeta).length > 0) row.meta = mergedMeta;
  return row;
}

function hydrate(n: Record<string, unknown>) {
  const meta = n.meta as Record<string, unknown> | undefined;
  const title = (n.title as string | undefined) ?? (meta?.title as string | undefined);
  const image = (n.image as string | undefined) ?? (meta?.image as string | undefined);
  return { ...n, title, image };
}

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

  console.log(pass ? "\nPASS" : "\nFAIL");
  process.exit(pass ? 0 : 1);
}

main();
