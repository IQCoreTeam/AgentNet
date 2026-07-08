// SOUL.md section parser (plans/soul-memory-portability.md §3C). The soul's canonical
// form IS markdown — people write personas as prose, not schemas — so this parser is
// deliberately forgiving: it lifts out the RECOGNIZED sections that structured
// renderers (Eliza's characterfile) need, and preserves everything else verbatim so an
// unrecognized section round-trips untouched. Markdown-first, lossy only downhill.

export interface SoulSection {
  /** The heading line without the leading #s, e.g. "Custom Rituals". */
  heading: string;
  /** Raw markdown body of the section (heading excluded), trimmed. */
  body: string;
}

export interface ParsedSoul {
  /** From the `# Name` section's first non-empty line (or an H1 like `# Luna`). */
  name?: string;
  bio: string[];
  style: string[];
  lore: string[];
  boundaries: string[];
  /** Sections we don't recognize — preserved in order, heading + raw body. */
  extras: SoulSection[];
}

const RECOGNIZED = new Set(["bio", "style", "lore", "boundaries"]);

/** Turn a section body into list items: bullets shed their marker; plain non-empty
 *  lines count as items too (people write both). */
function toItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*]\s+/, ""));
}

export function parseSoul(text: string): ParsedSoul {
  const soul: ParsedSoul = { bio: [], style: [], lore: [], boundaries: [], extras: [] };

  // Split into (heading, body) chunks on ATX headings (# / ##). Content before the
  // first heading is an anonymous extra so nothing is dropped.
  const lines = text.split("\n");
  const sections: { level: number; heading: string; body: string[] }[] = [];
  let cur = { level: 0, heading: "", body: [] as string[] };
  for (const line of lines) {
    const m = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (m) {
      sections.push(cur);
      cur = { level: m[1].length, heading: m[2], body: [] };
    } else {
      cur.body.push(line);
    }
  }
  sections.push(cur);

  for (const s of sections) {
    const body = s.body.join("\n").trim();
    if (s.level === 0) {
      if (body) soul.extras.push({ heading: "", body });
      continue;
    }
    const key = s.heading.toLowerCase();
    if (s.level === 1) {
      // `# Name` section: the body's first line is the name. A bare `# Luna` (any H1
      // that isn't the literal "Name" and has no recognized use) IS the name.
      if (key === "name") {
        const first = toItems(body)[0];
        if (first) soul.name = first;
      } else if (!soul.name) {
        soul.name = s.heading;
        if (body) soul.extras.push({ heading: s.heading, body });
      } else {
        soul.extras.push({ heading: s.heading, body });
      }
      continue;
    }
    if (RECOGNIZED.has(key)) {
      soul[key as "bio" | "style" | "lore" | "boundaries"].push(...toItems(body));
    } else {
      soul.extras.push({ heading: s.heading, body });
    }
  }
  return soul;
}
