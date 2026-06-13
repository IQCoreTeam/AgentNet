// On-chain constraints adapter — the DEFAULT gate used by publishSkill.
//
// Extends strict with our on-chain-specific rules:
//   category:  missing → warning (needed for search trait)
//   hashtags:  any tag with uppercase or spaces → warning
//
// NO size limit: codeIn auto-chunks data past the 700B inline threshold (850B
// chunks linked by on_chain_path) and readCodeIn reads inline or chunked the
// same way — so skill length is never a publish constraint.

import { type ValidationAdapter, type ValidationResult, addIssue } from "../types.js";
import { StrictAdapter } from "./strict.js";

/** Hashtag must be lowercase, no spaces, no leading #. */
const HASHTAG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export class OnchainAdapter implements ValidationAdapter {
  readonly id = "onchain";

  private readonly strict = new StrictAdapter();

  async checkFormat(skillMd: string): Promise<ValidationResult> {
    const result = await this.strict.checkFormat(skillMd);

    // ── category check ────────────────────────────────────────────────────────
    const { frontmatter } = (await import("../parse.js").then((m) => ({
      frontmatter: m.parseSkillMd(skillMd).frontmatter,
    })));

    if (!frontmatter.category) {
      addIssue(result, {
        field: "category",
        severity: "warning",
        message: '"category" is recommended for on-chain search trait filtering',
      });
    }

    // ── hashtag check ─────────────────────────────────────────────────────────
    const hashtags = frontmatter.hashtags as string[] | undefined;
    if (hashtags && Array.isArray(hashtags)) {
      for (const tag of hashtags) {
        const clean = tag.replace(/^#/, ""); // strip leading # if present
        if (!HASHTAG_RE.test(clean)) {
          addIssue(result, {
            field: "hashtags",
            severity: "warning",
            message: `Hashtag "${tag}" should be lowercase, no spaces, alphanumeric/hyphens only`,
          });
        }
      }
    }

    return result;
  }
}

/** The default validator used by publishSkill. */
export const defaultValidator: ValidationAdapter = new OnchainAdapter();
