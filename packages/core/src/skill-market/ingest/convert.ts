// NFT skill metadata → a SKILL.md file (issue #17). The runtime discovers a skill
// purely by filesystem placement: it scans a skills dir and reads each SKILL.md's
// frontmatter (name + description) at session start, loading the body only on demand
// (verified against last30days-skill — plans/skill-ingestion.md §8a). So installing a
// bought skill is just: write {skillsDir}/{name}/SKILL.md with that minimal shape.
//
// The body lives on-chain as the code-in JSON's `skillText` (readSkillMintMetadata).
// A publisher MAY have authored skillText with its own YAML frontmatter; if so we keep
// it verbatim. Otherwise we synthesize frontmatter from the NFT's name + description so
// the runtime always has the two keys it needs to list the skill.

import type { SkillMintMetadata } from "../../nft/token2022.js";

// A safe directory/skill slug from a display name: lowercase, [a-z0-9-], ≤64 chars —
// the SKILL.md `name` convention (Claude requires it). "" when the name has no usable chars.
export function slugifyName(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

// A mint's install slug: its slugified name, falling back to the mint id.
export function skillSlug(meta: SkillMintMetadata, mint: string): string {
  return slugifyName(meta.name) || `skill-${mint.slice(0, 8).toLowerCase()}`;
}

// Content identity of a SKILL.md: the body with frontmatter stripped and whitespace
// collapsed. Frontmatter is excluded because a hand-copied file and an on-chain render
// may synthesize it differently while the actual skill content is byte-for-byte the same.
// Equality of two NON-EMPTY keys means "verbatim copy of that skill's content" — the
// pirate check's bar (a name-only collision never matches on content alone).
export function skillBodyKey(md: string): string {
  return md
    .replace(/^﻿/, "")
    .replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Does the skill body already start with its own YAML frontmatter block?
function hasFrontmatter(body: string): boolean {
  return /^---\s*\n[\s\S]*?\n---\s*(\n|$)/.test(body.replace(/^﻿/, ""));
}

// Escape a value for a single-line YAML scalar (quote + escape quotes/newlines).
function yamlScalar(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").trim()}"`;
}

// Normalize a publisher-authored frontmatter block to STRICT YAML. The skills shipped
// by Anthropic (pptx, docx, …) carry an unquoted `description:` whose text contains
// ": " (e.g. "This includes: creating decks") — Claude's loader tolerates it, but
// codex's stricter YAML parser reads the inner ": " as a nested mapping and rejects
// the whole file ("mapping values are not allowed"), silently dropping the skill for
// the codex runtime. We re-emit each inline plain scalar value through yamlScalar so
// both runtimes load it. Flow collections ([..]/{..}), block scalars (| / >), and
// already-quoted values are left untouched.
function normalizeFrontmatter(body: string): string {
  const m = body.replace(/^﻿/, "").match(/^(---\s*\n)([\s\S]*?)(\n---\s*(?:\n|$))([\s\S]*)$/);
  if (!m) return body;
  const [, open, inner, close, rest] = m;
  let blockIndent: number | null = null; // inside a `key: |`/`>` block scalar
  const lines = inner.split("\n").map((line) => {
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null) {
      if (line.trim() === "" || indent > blockIndent) return line; // block content
      blockIndent = null;
    }
    const kv = line.match(/^(\s*)([\w.-]+):[ \t]+(\S.*?)[ \t]*$/);
    if (!kv) return line; // key-only line, list item, comment, blank
    const [, ind, key, value] = kv;
    if (/^[|>]/.test(value)) { blockIndent = ind.length; return line; } // block scalar
    if (/^["'[{&*!#]/.test(value)) return line; // already quoted / flow / anchor / tag
    return `${ind}${key}: ${yamlScalar(value)}`;
  });
  return `${open}${lines.join("\n")}${close}${rest}`;
}

/**
 * A workflow's SKILL.md must tell the agent it ISN'T a plain skill: it's a composite
 * that orchestrates the skills it was built from (the buy gate guarantees those skills
 * are owned, so they're installed as their own SKILL.md entries too). Without this note
 * a workflow reads as just another skill and the agent never chains its parts. Appended
 * to the body (loaded on demand) so it's there whether or not the publisher authored
 * their own frontmatter. `names` are the constituent skills' display names (caller
 * resolves them; falls back to short mint ids).
 */
function workflowNote(names: string[]): string {
  return [
    "",
    "## Workflow",
    "This is a workflow, not a single skill: it combines the skills below, which you already",
    "have installed. Use them together to carry out the task this workflow is for.",
    "",
    ...names.map((n) => `- ${n}`),
    "",
  ].join("\n");
}

/**
 * Render an NFT skill's metadata to SKILL.md text. Required frontmatter (`name`,
 * `description`) is always present; `category` becomes a single trait line and each
 * hashtag a repeated one (the same standard attributes shape we store on-chain). If
 * the body already carries frontmatter, it's returned untouched (the publisher owns
 * the full SKILL.md). `name`/`description` fall back so the file is always valid.
 *
 * `requiredSkillNames` (non-empty ⇒ this mint is a workflow) appends a Workflow note and
 * labels the description so the agent both lists it as a workflow and knows what it chains.
 */
export function toSkillMd(meta: SkillMintMetadata, mint: string, requiredSkillNames?: string[]): string {
  const isWorkflow = !!(requiredSkillNames && requiredSkillNames.length);
  const note = isWorkflow ? workflowNote(requiredSkillNames!) : "";
  const body = (meta.skillText ?? "").trim();
  if (hasFrontmatter(body)) return `${normalizeFrontmatter(body)}${note}\n`;

  const name = skillSlug(meta, mint);
  const baseDesc = meta.description || meta.name || name;
  const description = isWorkflow ? `Workflow combining ${requiredSkillNames!.length} skills. ${baseDesc}` : baseDesc;
  const lines = [`name: ${name}`, `description: ${yamlScalar(description)}`];
  if (meta.category) lines.push(`category: ${yamlScalar(meta.category)}`);
  for (const tag of meta.hashtags ?? []) lines.push(`skill: ${yamlScalar(tag)}`);

  return `---\n${lines.join("\n")}\n---\n\n${body || `# ${meta.name || name}`}${note}\n`;
}
