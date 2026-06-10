// Minimal skills.sh compatibility adapter.
//
// Enforces only what the official skills.sh CLI enforces today:
//   - `name` must be present and a non-empty string
//   - `description` must be present and a non-empty string
//
// This is the lowest-bar adapter. Use it when importing skills from skills.sh
// or when you want the lightest possible gate.

import { type ValidationAdapter, type ValidationResult, emptyResult, addIssue } from "../types.js";
import { parseSkillMd } from "../parse.js";

export class SkillsShCompatAdapter implements ValidationAdapter {
  readonly id = "skills-sh-compat";

  async validate(skillMd: string): Promise<ValidationResult> {
    const result = emptyResult();
    const { frontmatter } = parseSkillMd(skillMd);

    if (!frontmatter.name || typeof frontmatter.name !== "string" || !frontmatter.name.trim()) {
      addIssue(result, {
        field: "name",
        severity: "error",
        message: "\"name\" is required and must be a non-empty string",
      });
    }

    if (
      !frontmatter.description ||
      typeof frontmatter.description !== "string" ||
      !frontmatter.description.trim()
    ) {
      addIssue(result, {
        field: "description",
        severity: "error",
        message: "\"description\" is required and must be a non-empty string",
      });
    }

    return result;
  }
}
