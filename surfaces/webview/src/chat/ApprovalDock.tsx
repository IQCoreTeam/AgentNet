import type { ApprovalOutcome, ApprovalRequest } from "../transport/protocol";
import { useStore } from "../state/store";

// Pending tool approvals, docked just above the composer (newest first). Answering posts
// the decision and removes the card immediately. While any card is present the composer
// is frozen (see Composer) — same behavior as the vscode webview.
export function ApprovalDock() {
  const { state, send, resolveApproval } = useStore();
  if (state.approvals.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-3 pt-2">
      {state.approvals.map((req) => (
        <ApprovalCard
          key={req.id}
          req={req}
          onDecide={(outcome) => {
            resolveApproval(req.id);
            send({ type: "approvalDecision", id: req.id, outcome });
          }}
        />
      ))}
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
  return (
    <div className="overflow-hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="font-mono text-emerald-400">
          {req.kind === "bash" ? "$" : req.kind === "read" ? "□" : "✎"}
        </span>
        <span className="truncate font-medium">{req.title || req.tool}</span>
        <span className="ml-auto text-xs text-zinc-500">{req.cli}</span>
      </div>

      {req.command && (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-xs text-zinc-200">
          {req.command}
        </pre>
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
          Approve
        </button>
        <button
          onClick={() => onDecide("always")}
          className="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100"
        >
          Always
        </button>
        <button
          onClick={() => onDecide("deny")}
          className="rounded bg-red-900/60 px-3 py-1 text-xs text-red-200"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
