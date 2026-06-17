import { useState } from "react";
import type {
  ApprovalOutcome,
  ApprovalQuestionResponse,
  ApprovalRequest,
} from "../transport/protocol";
import { useStore } from "../state/store";

// Pending tool approvals, docked just above the composer (newest first). Most are a
// yes/no permission (bash/edit/…). Two are different:
//   - "question" (claude's AskUserQuestion / codex requestUserInput): a structured or
//     free-text prompt — the user's answer becomes the tool result.
//   - "plan" (ExitPlanMode): show the plan, approve to implement or send back to revise.
// While any card is present the composer is frozen (see Composer).
export function ApprovalDock() {
  const { state, send, resolveApproval } = useStore();
  if (state.approvals.length === 0) return null;

  function decide(
    req: ApprovalRequest,
    outcome: ApprovalOutcome,
    extra?: { reason?: string; updatedInput?: Record<string, unknown>; questionResponses?: ApprovalQuestionResponse[] },
  ) {
    resolveApproval(req.id);
    send({ type: "approvalDecision", id: req.id, outcome, ...extra });
  }

  return (
    <div className="flex max-h-52 flex-col gap-2 overflow-y-auto px-3 pt-2">
      {state.approvals.map((req) =>
        req.kind === "question" && req.questions?.length ? (
          <QuestionCard key={req.id} req={req} onAnswer={(a) => decide(req, "once", { questionResponses: a })} />
        ) : (
          <ApprovalCard key={req.id} req={req} onDecide={(o, extra) => decide(req, o, extra)} />
        ),
      )}
    </div>
  );
}

// AskUserQuestion: render each question with selectable options and, when allowed, a
// free-text field. "Send" is enabled once every question has an answer.
function QuestionCard({
  req,
  onAnswer,
}: {
  req: ApprovalRequest;
  onAnswer: (questionResponses: ApprovalQuestionResponse[]) => void;
}) {
  const questions = req.questions ?? [];
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [customInput, setCustomInput] = useState<Record<number, string>>({});

  function toggle(qi: number, label: string, multi: boolean) {
    setCustomInput((prev) => {
      if (!(qi in prev)) return prev;
      const next = { ...prev };
      delete next[qi];
      return next;
    });
    setSelections((prev) => {
      const cur = prev[qi] ?? [];
      if (multi) {
        return { ...prev, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      }
      return { ...prev, [qi]: cur[0] === label ? [] : [label] };
    });
  }

  function setTypedAnswer(qi: number, value: string) {
    setCustomInput((prev) => ({ ...prev, [qi]: value }));
    setSelections((prev) => ({ ...prev, [qi]: [] }));
  }

  const allAnswered = questions.every((_, qi) => {
    const typed = customInput[qi]?.trim();
    return !!typed || (selections[qi]?.length ?? 0) > 0;
  });

  function submit() {
    const questionResponses = questions.map((q, qi) => {
      const typed = customInput[qi]?.trim();
      return {
        question: q.question,
        questionId: q.id,
        selected: typed ? [] : (selections[qi] ?? []),
        ...(typed ? { text: typed } : {}),
      };
    });
    onAnswer(questionResponses);
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
          {q.options.length > 0 && (
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
          )}
          {q.allowCustomInput && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="text-xs text-zinc-400">
                {q.options.length > 0 ? "Or type your own answer" : "Type your answer"}
              </div>
              {q.secret ? (
                <input
                  type="password"
                  value={customInput[qi] ?? ""}
                  onChange={(e) => setTypedAnswer(qi, e.target.value)}
                  placeholder="Type your answer…"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500"
                />
              ) : (
                <textarea
                  rows={3}
                  value={customInput[qi] ?? ""}
                  onChange={(e) => setTypedAnswer(qi, e.target.value)}
                  placeholder="Type your answer…"
                  className="resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500"
                />
              )}
            </div>
          )}
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
  onDecide: (o: ApprovalOutcome, extra?: { reason?: string; updatedInput?: Record<string, unknown> }) => void;
}) {
  const isPlan = req.kind === "plan";
  const isDanger = req.risk === "danger";
  const [editMode, setEditMode] = useState(false);
  const [editedCmd, setEditedCmd] = useState(req.command ?? "");
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");

  const borderColor = isDanger ? "border-red-700/60" : "border-emerald-700/50";
  const bgColor = isDanger ? "bg-red-950/20" : "bg-emerald-950/30";

  return (
    <div className={`overflow-hidden rounded-lg border ${borderColor} ${bgColor} text-sm`}>
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {isDanger && (
          <span className="font-bold text-red-400">⚠ DANGER</span>
        )}
        <span className="font-mono text-emerald-400">
          {req.kind === "bash" ? "$" : req.kind === "read" ? "□" : isPlan ? "✦" : "✎"}
        </span>
        <span className="truncate font-medium">{req.title || req.tool}</span>
        <span className="ml-auto text-xs text-zinc-500">{req.cli}</span>
        {/* bash: edit toggle */}
        {req.kind === "bash" && req.command && (
          <button
            onClick={() => setEditMode((e) => !e)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {editMode ? "cancel" : "edit"}
          </button>
        )}
      </div>

      {/* detail */}
      {req.command && !editMode && (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-xs text-zinc-200">
          {req.command}
        </pre>
      )}
      {req.kind === "bash" && editMode && (
        <textarea
          value={editedCmd}
          onChange={(e) => setEditedCmd(e.target.value)}
          rows={3}
          className="w-full resize-y bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none border-t border-zinc-700"
        />
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

      {/* deny-with-reason input */}
      {showReason && (
        <div className="flex items-center gap-2 border-t border-zinc-700 px-3 py-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            autoFocus
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
            onKeyDown={(e) => {
              if (e.key === "Enter") onDecide("deny", { reason: reason.trim() || undefined });
              if (e.key === "Escape") { setShowReason(false); setReason(""); }
            }}
          />
          <button
            onClick={() => onDecide("deny", { reason: reason.trim() || undefined })}
            className="rounded bg-red-900/60 px-2 py-1 text-xs text-red-200"
          >
            Deny
          </button>
          <button
            onClick={() => { setShowReason(false); setReason(""); }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ↩
          </button>
        </div>
      )}

      {/* action buttons */}
      <div className="flex flex-wrap gap-2 border-t border-emerald-700/40 px-3 py-2">
        {isPlan ? (
          <>
            <button autoFocus onClick={() => onDecide("once")} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white">
              Approve plan
            </button>
            <button onClick={() => onDecide("deny")} className="rounded bg-red-900/60 px-3 py-1 text-xs text-red-200">
              Keep planning
            </button>
          </>
        ) : editMode ? (
          <>
            <button
              autoFocus
              onClick={() => onDecide("once", { updatedInput: { ...(req.input ?? {}), command: editedCmd } })}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white"
            >
              Approve edited
            </button>
            <button onClick={() => setEditMode(false)} className="rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-200">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button autoFocus onClick={() => onDecide("once")} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white">
              Approve
            </button>
            <button onClick={() => onDecide("always")} className="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100">
              Always
            </button>
            <button
              onClick={() => { setShowReason((s) => !s); }}
              className="rounded bg-red-900/60 px-3 py-1 text-xs text-red-200"
            >
              Deny…
            </button>
          </>
        )}
      </div>
    </div>
  );
}
