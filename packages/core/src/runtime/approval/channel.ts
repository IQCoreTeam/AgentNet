// ApprovalChannel — the SEAM between "an engine wants to run a tool" and "someone
// decides yes/no". The engine (claude SDK canUseTool, or codex) produces a neutral
// ApprovalRequest and awaits an ApprovalDecision; HOW that decision is obtained is a
// swappable channel: a webview button today, a phone push tomorrow, an auto-policy
// in CI. The engine never knows which — it just calls channel.request().
//
// This is deliberately CLI/SDK-neutral (no claude/codex types leak in) so the same
// request can be rendered on any surface and answered from anywhere.

// A multiple-choice question (claude's AskUserQuestion): one or more questions, each with
// options the user picks from. NOT a yes/no permission — the user's CHOICE becomes the
// tool result, so the decision carries `answers` rather than just allow/deny.
export interface ApprovalQuestion {
  question: string;       // the prompt text (also the answer key the SDK expects back)
  header?: string;        // short label/chip
  multiSelect?: boolean;  // may the user pick more than one option
  options: { label: string; description?: string }[];
}

// A pending tool action that needs a decision. `kind` lets a surface render it well
// (a bash card with the command, a diff card with the patch, a choice list) without
// parsing input.
export interface ApprovalRequest {
  id: string;             // unique per request; the decision must echo it back
  cli: "claude" | "codex";
  sessionId: string;      // canonical session this belongs to
  tool: string;           // tool name as the engine reports it (Bash, Edit, Write…)
  kind: "bash" | "edit" | "write" | "read" | "question" | "plan" | "other";
  title: string;          // one-line human summary ("Run: npm test", "Edit foo.ts")
  command?: string;       // bash/shell command, when kind === "bash"
  cwd?: string;           // working dir the action runs in (so a surface can show WHERE)
  file?: string;          // target path, for edit/write/read
  diff?: string;          // unified-ish diff for an edit ("-old"/"+new" lines)
  risk?: "danger";        // flagged destructive/irreversible action — surface should alarm
  questions?: ApprovalQuestion[]; // when kind === "question": the choices to present
  plan?: string;          // when kind === "plan": the plan text awaiting approval
  input?: Record<string, unknown>; // raw tool input, for surfaces that want detail
}

// The answer. "once" allows just this call; "always" allows + remembers (the engine
// may widen its permission rules); "deny" blocks with an optional reason. updatedInput
// lets an approver tweak args before the tool runs (claude supports this). For a
// `question` request, `answers` maps each question text → the chosen option label(s)
// (joined with ", " when multiSelect); the engine turns that into the tool result.
export interface ApprovalDecision {
  outcome: "once" | "always" | "deny";
  reason?: string;                       // shown to the model on deny
  updatedInput?: Record<string, unknown>; // override the tool input (allow path only)
  answers?: Record<string, string>;      // question text → selected label(s)
}

// The swappable decision source. One method: given a request, resolve a decision.
// Implementations: WebviewApprovalChannel (buttons), PolicyApprovalChannel (auto),
// later PushApprovalChannel (mobile alarm). All interchangeable.
export interface ApprovalChannel {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

// Convenience: a channel that always returns the same outcome (no UI). Used as the
// codex default (sandbox-governed) and as a safe fallback when no surface is wired.
export function autoApprove(outcome: ApprovalDecision["outcome"] = "once"): ApprovalChannel {
  return { request: async () => ({ outcome }) };
}
