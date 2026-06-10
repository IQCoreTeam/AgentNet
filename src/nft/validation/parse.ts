// SKILL.md frontmatter parser.
//
// Parses the YAML block delimited by `---` at the top of a SKILL.md string.
// Uses only basic string splitting — no eval, no YAML library import — to
// avoid any RCE risk from untrusted skill content (CWE-78 / CWE-150).
//
// Also exports sanitize() to strip terminal-escape sequences from text before
// display (CWE-150).

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  type?: "skill" | "workflow";
  requiredSkills?: string[];
  author?: string;
  license?: string;
  repository?: string;
  keywords?: string[];
  agents?: string[];
  category?: string;
  hashtags?: string[];
  [key: string]: unknown;
}

export interface ParseResult {
  frontmatter: SkillFrontmatter;
  /** Skill body — everything after the closing `---`. */
  body: string;
}

/**
 * Parse a SKILL.md string into frontmatter + body.
 * Returns empty frontmatter + full text as body if no valid block is found.
 */
export function parseSkillMd(skillMd: string): ParseResult {
  const lines = skillMd.split("\n");

  // Must start with --- (allow optional trailing whitespace)
  if (!lines[0]?.trim().startsWith("---")) {
    return { frontmatter: {}, body: skillMd };
  }

  // Find the closing ---
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    // No closing delimiter — treat as no frontmatter
    return { frontmatter: {}, body: skillMd };
  }

  const yamlLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join("\n").trimStart();
  const frontmatter: SkillFrontmatter = {};

  for (const line of yamlLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Detect YAML list value: starts with [  or multi-line bullet (not supported here — single-line only)
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const items = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      (frontmatter as Record<string, unknown>)[key] = items;
    } else {
      // Strip surrounding quotes
      const value = raw.replace(/^['"]|['"]$/g, "");
      (frontmatter as Record<string, unknown>)[key] = value;
    }
  }

  return { frontmatter, body };
}

/** Strip ANSI / terminal-escape sequences (CWE-150 display safety). */
// eslint-disable-next-line no-control-regex
const ESCAPE_RE = /(\x9B|\x1B\[)[0-?]*[ -\/]*[@-~]|\x1B[^[]/g;

export function sanitize(text: string): string {
  return text.replace(ESCAPE_RE, "");
}

/** Validate an SPDX license identifier (simple heuristic — non-empty, no spaces). */
export function isValidSpdx(license: string): boolean {
  // Full SPDX list is enormous; we do a pragmatic check:
  // non-empty, no leading/trailing whitespace, no internal newlines.
  return license.trim().length > 0 && !/[\n\r ]/.test(license.trim());
}

/** Validate a URL (http/https only). */
export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
