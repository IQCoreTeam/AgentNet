// On-chain constraints adapter — the DEFAULT gate used by publishSkill.
//
// Extends strict with our on-chain-specific rules:
//   size:      total skillMd bytes > 700 → error (won't fit an inline 1-tx code-in)
//   category:  missing → warning (needed for search trait)
//   hashtags:  any tag with uppercase or spaces → warning

import { type ValidationAdapter, type ValidationResult, addIssue } from "../types.js";
import { StrictAdapter } from "./strict.js";

/** Max bytes for an inline (single-tx) code-in. From iqlabs-sdk constants. */
export const INLINE_MAX_BYTES = 700;

/** Hashtag must be lowercase, no spaces, no leading #. */
const HASHTAG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export class OnchainAdapter implements ValidationAdapter {
  readonly id = "onchain";

  private readonly strict = new StrictAdapter();

  async validate(skillMd: string): Promise<ValidationResult> {
    const result = await this.strict.validate(skillMd);

    // ── size check ────────────────────────────────────────────────────────────
    const byteLen = new TextEncoder().encode(skillMd).length;
    if (byteLen > INLINE_MAX_BYTES) {
      addIssue(result, {
        field: "size",
        severity: "error",
        message:
          `Skill is ${byteLen}B, exceeding the ${INLINE_MAX_BYTES}B inline limit. ` +
          `Split into a smaller skill or set allowChunking: true to allow multi-tx code-in.`,
      });
    }

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
