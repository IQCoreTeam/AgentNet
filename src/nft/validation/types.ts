// Validation adapter types.
//
// ValidationAdapter — pluggable gate; each adapter enforces a set of rules.
// ValidationResult  — ok = false if any errors exist.
// Issue             — a single rule violation (error | warning | info).

export type Severity = "error" | "warning" | "info";

export interface Issue {
  field: string;
  severity: Severity;
  message: string;
}

export interface ValidationResult {
  ok: boolean;       // false when errors.length > 0
  errors: Issue[];
  warnings: Issue[];
  infos: Issue[];
}

export interface ValidationAdapter {
  /** Unique identifier e.g. "skills-sh-compat" | "strict" | "onchain" | "security-llm" */
  readonly id: string;
  checkFormat(skillMd: string): Promise<ValidationResult>;
}

/** Thrown by publishSkill when the default (or provided) validator rejects. */
export class ValidationError extends Error {
  constructor(public readonly issues: Issue[]) {
    const summary = issues.map((i) => `[${i.field}] ${i.message}`).join("; ");
    super(`Skill validation failed: ${summary}`);
    this.name = "ValidationError";
  }
}

/** Helper — build an empty result (passes by default). */
export function emptyResult(): ValidationResult {
  return { ok: true, errors: [], warnings: [], infos: [] };
}

/** Helper — merge a new issue into a result, flipping ok on error. */
export function addIssue(result: ValidationResult, issue: Issue): void {
  if (issue.severity === "error") {
    result.errors.push(issue);
    result.ok = false;
  } else if (issue.severity === "warning") {
    result.warnings.push(issue);
  } else {
    result.infos.push(issue);
  }
}
