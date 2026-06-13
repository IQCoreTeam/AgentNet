// Barrel export for src/nft/validation/.
//
// Public API:
//   defaultValidator  — OnchainAdapter instance (used by publishSkill by default)
//   compose           — chain multiple adapters
//   createSecurityLlmAdapter — wrap an LLM review function as an adapter
//   ValidationError   — thrown by publishSkill on gate failure
//   Types             — ValidationAdapter, ValidationResult, Issue, Severity

export { defaultValidator } from "./adapters/onchain.js";
export { SkillsShCompatAdapter } from "./adapters/compat.js";
export { StrictAdapter } from "./adapters/strict.js";
export { OnchainAdapter } from "./adapters/onchain.js";
export { WorkflowAdapter, defaultWorkflowValidator } from "./adapters/workflow.js";
export { createSecurityLlmAdapter } from "./adapters/security.js";
export type { ReviewFn } from "./adapters/security.js";
export { compose } from "./compose.js";
export type { ComposeOptions } from "./compose.js";
export {
  ValidationError,
  emptyResult,
  addIssue,
} from "./types.js";
export type {
  ValidationAdapter,
  ValidationResult,
  Issue,
  Severity,
} from "./types.js";
export { parseSkillMd, sanitize, isValidSpdx, isValidUrl } from "./parse.js";
export type { SkillFrontmatter, ParseResult } from "./parse.js";
