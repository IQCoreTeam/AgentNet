import { useState } from "react";
import type { ApprovalOutcome, ApprovalRequest } from "../transport/protocol";
import { useStore } from "../state/store";

// Pending tool approvals, docked just above the composer (newest first). Most are a
// yes/no permission (bash/edit/…). Two are different:
//   - "question" (claude's AskUserQuestion): a multiple-choice prompt — the user PICKS an
//     option and that choice becomes the tool result (sent as `answers`).
//   - "plan" (ExitPlanMode): show the plan, approve to implement or send back to revise.
// While any card is present the composer is frozen (see Composer).
export function ApprovalDock() {
  const { state, send, resolveApproval } = useStore();
  if (state.approvals.length === 0) return null;

  function decide(req: ApprovalRequest, outcome: ApprovalOutcome, answers?: Record<string, string>) {
    resolveApproval(req.id);
    send({ type: "approvalDecision", id: req.id, outcome, answers });
  }

  return (
    <div className="flex flex-col gap-2 px-3 pt-2">
      {state.approvals.map((req) =>
        req.kind === "question" && req.questions?.length ? (
          <QuestionCard key={req.id} req={req} onAnswer={(a) => decide(req, "once", a)} />
        ) : (
          <ApprovalCard key={req.id} req={req} onDecide={(o) => decide(req, o)} />
        ),
      )}
    </div>
  );
}

// AskUserQuestion: render each question with its options as selectable chips. Single- or
// multi-select per question; "Send" is enabled once every question has an answer.
function QuestionCard({
  req,
  onAnswer,
}: {
  req: ApprovalRequest;
  onAnswer: (answers: Record<string, string>) => void;
}) {
  const questions = req.questions ?? [];
  // selections[qIndex] = set of chosen labels for that question
  const [selections, setSelections] = useState<Record<number, string[]>>({});

  function toggle(qi: number, label: string, multi: boolean) {
    setSelections((prev) => {
      const cur = prev[qi] ?? [];
      if (multi) {
        return { ...prev, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      }
      return { ...prev, [qi]: cur[0] === label ? [] : [label] };
    });
  }

  const allAnswered = questions.every((_, qi) => (selections[qi]?.length ?? 0) > 0);

  function submit() {
    const answers: Record<string, string> = {};
    questions.forEach((q, qi) => {
      answers[q.question] = (selections[qi] ?? []).join(", ");
    });
    onAnswer(answers);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-700/50 bg-emerald-950/20 text-sm">
      {questions.map((q, qi) => (
        <div key={qi} className="border-b border-emerald-700/20 px-3 py-2.5 last:border-b-0">
          {q.header && (
            <div className="mb-1 inline-block rounded bg-emerald-700/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
              {q.header}
            </div>
          )}
          <div className="mb-2 font-medium text-zinc-100">{q.question}</div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((opt) => {
              const chosen = (selections[qi] ?? []).includes(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => toggle(qi, opt.label, q.multiSelect === true)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    chosen
                      ? "border-emerald-500 bg-emerald-600/20"
                      : "border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  <div className="text-sm font-medium text-zinc-100">{opt.label}</div>
                  {opt.description && (
                    <div className="mt-0.5 text-xs leading-snug text-zinc-400">{opt.description}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="px-3 py-2">
        <button
          disabled={!allAnswered}
          onClick={submit}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function ApprovalCard({
  req,
  onDecide,
}: {
  req: ApprovalRequest;
  onDecide: (o: ApprovalOutcome) => void;
}) {
  const isPlan = req.kind === "plan";
  return (
    <div className="overflow-hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="font-mono text-emerald-400">
          {req.kind === "bash" ? "$" : req.kind === "read" ? "□" : isPlan ? "✦" : "✎"}
        </span>
        <span className="truncate font-medium">{req.title || req.tool}</span>
        <span className="ml-auto text-xs text-zinc-500">{req.cli}</span>
      </div>

      {req.command && (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-xs text-zinc-200">
          {req.command}
        </pre>
      )}
      {req.plan && (
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap px-3 pb-2 text-xs leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
          {req.plan}
        </div>
      )}
      {req.file && !req.diff && (
        <div className="px-3 pb-2 font-mono text-xs text-zinc-300">{req.file}</div>
      )}
      {req.diff && (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-xs">
          {req.diff.split("\n").map((ln, i) => (
            <div
              key={i}
              className={
                ln[0] === "+"
                  ? "text-emerald-400"
                  : ln[0] === "-"
                    ? "text-red-400"
                    : "text-zinc-500"
              }
            >
              {ln}
            </div>
          ))}
        </pre>
      )}

      <div className="flex gap-2 border-t border-emerald-700/40 px-3 py-2">
        <button
          autoFocus
          onClick={() => onDecide("once")}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white"
        >
          {isPlan ? "Approve plan" : "Approve"}
        </button>
        {!isPlan && (
          <button
            onClick={() => onDecide("always")}
            className="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100"
          >
            Always
          </button>
        )}
        <button
          onClick={() => onDecide("deny")}
          className="rounded bg-red-900/60 px-3 py-1 text-xs text-red-200"
        >
          {isPlan ? "Keep planning" : "Deny"}
        </button>
      </div>
    </div>
  );
}
