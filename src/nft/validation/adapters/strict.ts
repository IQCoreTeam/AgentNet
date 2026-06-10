// Strict quality adapter — copies the rules from skills.sh PR #509.
//
// Rules (in addition to compat):
//   name:        1–64 chars, kebab-case pattern          → error
//   description: < 20 chars                              → error
//   description: > 500 chars                             → warning
//   body:        < 50 chars                              → info
//   license:     present but not SPDX-valid              → warning
//   repository:  present but not a valid URL             → warning

import { type ValidationAdapter, type ValidationResult, emptyResult, addIssue } from "../types.js";
import { parseSkillMd, isValidSpdx, isValidUrl } from "../parse.js";
import { SkillsShCompatAdapter } from "./compat.js";

const KEBAB_RE = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/;

export class StrictAdapter implements ValidationAdapter {
  readonly id = "strict";

  private readonly compat = new SkillsShCompatAdapter();

  async validate(skillMd: string): Promise<ValidationResult> {
    // Run compat layer first
    const result = await this.compat.validate(skillMd);

    const { frontmatter, body } = parseSkillMd(skillMd);
    const name = (frontmatter.name as string | undefined) ?? "";
    const description = (frontmatter.description as string | undefined) ?? "";

    // ── name rules ──────────────────────────────────────────────────────────
    if (name) {
      if (name.length < 1 || name.length > 64) {
        addIssue(result, {
          field: "name",
          severity: "error",
          message: `"name" must be 1–64 characters (got ${name.length})`,
        });
      } else if (!KEBAB_RE.test(name)) {
        addIssue(result, {
          field: "name",
          severity: "error",
          message:
            '"name" must be kebab-case (lowercase letters, digits, dots, hyphens; start & end with alphanumeric)',
        });
      }
    }

    // ── description rules ───────────────────────────────────────────────────
    if (description) {
      if (description.length < 20) {
        addIssue(result, {
          field: "description",
          severity: "error",
          message: `"description" is too short (${description.length} chars); minimum is 20`,
        });
      } else if (description.length > 500) {
        addIssue(result, {
          field: "description",
          severity: "warning",
          message: `"description" is long (${description.length} chars); consider keeping it under 500`,
        });
      }
    }

    // ── body ─────────────────────────────────────────────────────────────────
    if (body.trim().length < 50) {
      addIssue(result, {
        field: "body",
        severity: "info",
        message: `Skill body is very short (${body.trim().length} chars); consider expanding it`,
      });
    }

    // ── optional fields ───────────────────────────────────────────────────────
    const license = frontmatter.license as string | undefined;
    if (license && !isValidSpdx(license)) {
      addIssue(result, {
        field: "license",
        severity: "warning",
        message: `"license" value "${license}" does not look like a valid SPDX identifier`,
      });
    }

    const repository = frontmatter.repository as string | undefined;
    if (repository && !isValidUrl(repository)) {
      addIssue(result, {
        field: "repository",
        severity: "warning",
        message: `"repository" value "${repository}" is not a valid https:// URL`,
      });
    }

    return result;
  }
}
