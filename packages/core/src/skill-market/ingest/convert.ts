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

// A safe directory/skill slug: lowercase, [a-z0-9-], matching the SKILL.md `name`
// convention (Claude requires name ≤64 chars of [a-z0-9-]). Falls back to the mint.
export function skillSlug(meta: SkillMintMetadata, mint: string): string {
  const base = (meta.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || `skill-${mint.slice(0, 8).toLowerCase()}`).slice(0, 64);
}

// Does the skill body already start with its own YAML frontmatter block?
function hasFrontmatter(body: string): boolean {
  return /^---\s*\n[\s\S]*?\n---\s*(\n|$)/.test(body.replace(/^﻿/, ""));
}

// Escape a value for a single-line YAML scalar (quote + escape quotes/newlines).
function yamlScalar(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").trim()}"`;
}

/**
 * Render an NFT skill's metadata to SKILL.md text. Required frontmatter (`name`,
 * `description`) is always present; `category` becomes a single trait line and each
 * hashtag a repeated one (the same standard attributes shape we store on-chain). If
 * the body already carries frontmatter, it's returned untouched (the publisher owns
 * the full SKILL.md). `name`/`description` fall back so the file is always valid.
 */
export function toSkillMd(meta: SkillMintMetadata, mint: string): string {
  const body = (meta.skillText ?? "").trim();
  if (hasFrontmatter(body)) return `${body}\n`;

  const name = skillSlug(meta, mint);
  const description = meta.description || meta.name || name;
  const lines = [`name: ${name}`, `description: ${yamlScalar(description)}`];
  if (meta.category) lines.push(`category: ${yamlScalar(meta.category)}`);
  for (const tag of meta.hashtags ?? []) lines.push(`skill: ${yamlScalar(tag)}`);

  return `---\n${lines.join("\n")}\n---\n\n${body || `# ${meta.name || name}`}\n`;
}
