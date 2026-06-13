// Skill / workflow format check — ONE function, no pluggable adapters.
//
// publishSkill / publishWorkflow call checkFormat() / checkWorkflowFormat() before
// touching the chain. There is no swappable validator: the rules below ARE the
// format. (Frontmatter is parsed with plain string splitting — no eval / YAML lib —
// to avoid RCE from untrusted skill content. CWE-78 / CWE-150.)

export type Severity = "error" | "warning" | "info";

export interface Issue {
  field: string;
  severity: Severity;
  message: string;
}

export interface FormatResult {
  ok: boolean; // false when errors.length > 0
  errors: Issue[];
  warnings: Issue[];
  infos: Issue[];
}

/** Thrown by publishSkill / publishWorkflow when the format check fails. */
export class FormatError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(`Skill format check failed: ${issues.map((i) => `[${i.field}] ${i.message}`).join("; ")}`);
    this.name = "FormatError";
  }
}

function emptyResult(): FormatResult {
  return { ok: true, errors: [], warnings: [], infos: [] };
}

function add(result: FormatResult, field: string, severity: Severity, message: string): void {
  if (severity === "error") {
    result.errors.push({ field, severity, message });
    result.ok = false;
  } else if (severity === "warning") {
    result.warnings.push({ field, severity, message });
  } else {
    result.infos.push({ field, severity, message });
  }
}

// ── frontmatter parser (basic string splitting, no eval) ────────────────────────

interface Frontmatter {
  name?: string;
  description?: string;
  type?: string;
  requiredSkills?: string[];
  license?: string;
  repository?: string;
  category?: string;
  hashtags?: string[];
  [key: string]: unknown;
}

function parse(skillMd: string): { frontmatter: Frontmatter; body: string } {
  const lines = skillMd.split("\n");
  if (!lines[0]?.trim().startsWith("---")) return { frontmatter: {}, body: skillMd };

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { closeIdx = i; break; }
  }
  if (closeIdx === -1) return { frontmatter: {}, body: skillMd };

  const frontmatter: Frontmatter = {};
  for (const line of lines.slice(1, closeIdx)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (!key) continue;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      frontmatter[key] = raw.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else {
      frontmatter[key] = raw.replace(/^['"]|['"]$/g, "");
    }
  }
  return { frontmatter, body: lines.slice(closeIdx + 1).join("\n").trimStart() };
}

const KEBAB_RE = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/;
const HASHTAG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function isValidSpdx(license: string): boolean {
  return license.trim().length > 0 && !/[\n\r ]/.test(license.trim());
}
function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function isValidBase58(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

// ── the format check (all rules, one place) ────────────────────────────────────

/**
 * Check a skill's SKILL.md format. NO size limit (codeIn auto-chunks). Rules:
 *   name        — required; 1–64 chars; kebab-case            (error)
 *   description — required; ≥20 chars                          (error); >500 (warning)
 *   body        — <50 chars                                    (info)
 *   license     — present but not SPDX-like                    (warning)
 *   repository  — present but not an http(s) URL               (warning)
 *   category    — missing                                      (warning, search trait)
 *   hashtags    — uppercase / spaces / bad chars               (warning)
 */
export function checkFormat(skillMd: string): FormatResult {
  const result = emptyResult();
  const { frontmatter, body } = parse(skillMd);

  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  if (!name.trim()) {
    add(result, "name", "error", '"name" is required and must be a non-empty string');
  } else if (name.length < 1 || name.length > 64) {
    add(result, "name", "error", `"name" must be 1–64 characters (got ${name.length})`);
  } else if (!KEBAB_RE.test(name)) {
    add(result, "name", "error", '"name" must be kebab-case (lowercase letters, digits, dots, hyphens)');
  }

  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  if (!description.trim()) {
    add(result, "description", "error", '"description" is required and must be a non-empty string');
  } else if (description.length < 20) {
    add(result, "description", "error", `"description" is too short (${description.length} chars); minimum is 20`);
  } else if (description.length > 500) {
    add(result, "description", "warning", `"description" is long (${description.length} chars); keep it under 500`);
  }

  if (body.trim().length < 50) {
    add(result, "body", "info", `Skill body is very short (${body.trim().length} chars); consider expanding it`);
  }

  const license = frontmatter.license;
  if (typeof license === "string" && !isValidSpdx(license)) {
    add(result, "license", "warning", `"license" value "${license}" does not look like a valid SPDX identifier`);
  }
  const repository = frontmatter.repository;
  if (typeof repository === "string" && !isValidUrl(repository)) {
    add(result, "repository", "warning", `"repository" value "${repository}" is not a valid http(s) URL`);
  }

  if (!frontmatter.category) {
    add(result, "category", "warning", '"category" is recommended for on-chain search trait filtering');
  }
  if (Array.isArray(frontmatter.hashtags)) {
    for (const tag of frontmatter.hashtags) {
      if (!HASHTAG_RE.test(String(tag).replace(/^#/, ""))) {
        add(result, "hashtags", "warning", `Hashtag "${tag}" should be lowercase, no spaces, alphanumeric/hyphens only`);
      }
    }
  }

  return result;
}

/**
 * Check a workflow's SKILL.md format — the skill rules above PLUS:
 *   type           — must be exactly "workflow"               (error)
 *   requiredSkills — non-empty array of valid base58 mints    (error)
 */
export function checkWorkflowFormat(skillMd: string): FormatResult {
  const result = checkFormat(skillMd);
  const { frontmatter } = parse(skillMd);

  if (frontmatter.type !== "workflow") {
    add(result, "type", "error", '"type" must be exactly "workflow"');
  }
  const req = frontmatter.requiredSkills;
  if (!Array.isArray(req)) {
    add(result, "requiredSkills", "error", '"requiredSkills" must be an array of skill mint addresses');
  } else if (req.length === 0) {
    add(result, "requiredSkills", "error", '"requiredSkills" cannot be empty for a workflow');
  } else {
    const invalid = req.filter((k) => !isValidBase58(String(k)));
    if (invalid.length > 0) {
      add(result, "requiredSkills", "error", `requiredSkills has invalid mint addresses: ${invalid.join(", ")}`);
    }
  }

  return result;
}
