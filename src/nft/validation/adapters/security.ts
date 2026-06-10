// LLM-based text maliciousness adapter (Gen Agent Trust Hub style).
//
// The LLM call is INJECTABLE — callers provide a `reviewFn` callback.
// This keeps the adapter decoupled from any specific model or API (OpenAI,
// Claude, local), and makes it trivially mockable in tests.
//
// Usage:
//   const withSecurity = createSecurityLlmAdapter(myReviewFn);
//   const combined = compose(defaultValidator, withSecurity);
//   await publishSkill(conn, signer, input, { validator: combined });

import { type ValidationAdapter, type ValidationResult, emptyResult, addIssue } from "../types.js";

/**
 * A function that reviews skill text for malicious content.
 * Return { safe: true } to pass, { safe: false, reason: "..." } to reject.
 */
export type ReviewFn = (
  skillText: string,
) => Promise<{ safe: boolean; reason?: string }>;

/**
 * Create a security adapter backed by any review function.
 *
 * The adapter:
 *   - Calls `reviewFn(skillMd)`.
 *   - On `safe: false` → adds an error with the reason.
 *   - On any thrown exception → adds a warning (fail-open; don't block publish on LLM outage).
 */
export function createSecurityLlmAdapter(reviewFn: ReviewFn): ValidationAdapter {
  return {
    id: "security-llm",

    async validate(skillMd: string): Promise<ValidationResult> {
      const result = emptyResult();

      try {
        const review = await reviewFn(skillMd);
        if (!review.safe) {
          addIssue(result, {
            field: "content",
            severity: "error",
            message:
              review.reason
                ? `Skill content flagged as unsafe: ${review.reason}`
                : "Skill content was flagged as potentially malicious by the security review",
          });
        }
      } catch (err) {
        // LLM service unavailable — warn but don't hard-block
        addIssue(result, {
          field: "content",
          severity: "warning",
          message: `Security review unavailable (${(err as Error).message ?? "unknown error"}); publishing without LLM gate`,
        });
      }

      return result;
    },
  };
}
