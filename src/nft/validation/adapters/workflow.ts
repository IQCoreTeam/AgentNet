import { type ValidationAdapter, type ValidationResult, addIssue } from "../types.js";
import { OnchainAdapter } from "./onchain.js";

/** Validates that a string is a base58 address. Very basic heuristic. */
function isValidBase58(val: string): boolean {
  if (typeof val !== "string") return false;
  // Solana addresses are 32-44 characters, base58 encoded.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(val);
}

/**
 * Workflow adapter — default validator for publishWorkflow.
 * Extends OnchainAdapter with specific constraints for workflow NFTs.
 */
export class WorkflowAdapter implements ValidationAdapter {
  readonly id = "workflow";

  private readonly onchain = new OnchainAdapter();

  async validate(skillMd: string): Promise<ValidationResult> {
    const result = await this.onchain.validate(skillMd);

    const { frontmatter } = (await import("../parse.js")).parseSkillMd(skillMd);

    // 1. Must be type: "workflow"
    if (frontmatter.type !== "workflow") {
      addIssue(result, {
        field: "type",
        severity: "error",
        message: '"type" must be exactly "workflow"',
      });
    }

    // 2. requiredSkills must be an array of base58 addresses
    if (!frontmatter.requiredSkills || !Array.isArray(frontmatter.requiredSkills)) {
      addIssue(result, {
        field: "requiredSkills",
        severity: "error",
        message: '"requiredSkills" must be an array of skill mint addresses',
      });
    } else if (frontmatter.requiredSkills.length === 0) {
      addIssue(result, {
        field: "requiredSkills",
        severity: "error",
        message: '"requiredSkills" cannot be empty for a workflow',
      });
    } else {
      const invalidKeys = frontmatter.requiredSkills.filter((key) => !isValidBase58(key));
      if (invalidKeys.length > 0) {
        addIssue(result, {
          field: "requiredSkills",
          severity: "error",
          message: `"requiredSkills" contains invalid addresses: ${invalidKeys.join(", ")}`,
        });
      }
    }

    return result;
  }
}

/** Default validator for workflows. */
export const defaultWorkflowValidator: ValidationAdapter = new WorkflowAdapter();
