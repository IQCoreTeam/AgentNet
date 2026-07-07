import { useEffect, useRef, useState } from "react";
import type {
  ApprovalOutcome,
  ApprovalQuestionResponse,
  ApprovalRequest,
} from "../transport/protocol";
import { useStore, isApprovalForView } from "../state/store";
import { SkillIcon } from "../icons";
import { useElementHeightVariable } from "../layoutEffects";
import { haptics } from "../haptics";

// Pending tool approvals, docked just above the composer (newest first). Most are a
// yes/no permission (bash/edit/…). Two are different:
//   - "question" (claude's AskUserQuestion / codex requestUserInput): a structured or
//     free-text prompt — the user's answer becomes the tool result.
//   - "plan" (ExitPlanMode): show the plan, approve to implement or send back to revise.
// While any card is present the composer is frozen (see Composer).
export function ApprovalDock() {
  const { state, send, resolveApproval } = useStore();
  const rootRef = useRef<HTMLDivElement>(null);
  useElementHeightVariable(rootRef, "--approval-dock-height");

  function decide(
    req: ApprovalRequest,
    outcome: ApprovalOutcome,
    extra?: { reason?: string; updatedInput?: Record<string, unknown>; questionResponses?: ApprovalQuestionResponse[] },
  ) {
    if (outcome === "deny") haptics.error(); else haptics.tap();
    resolveApproval(req.id);
    send({ type: "approvalDecision", id: req.id, outcome, ...extra });
    if (req.kind === "plan" && outcome === "once") {
      send({ type: "mode", mode: "acceptEdits" });
    }
  }

  // Only the CURRENT chat's approvals dock inline. A backgrounded session's approval would
  // otherwise hijack the chat you're looking at; instead it pings you via a notification
  // (App.tsx forces one for non-active sessions) and tapping it jumps there. Approvals with
  // no sessionId, or when no chat is selected yet (fresh chat), still show — they belong here.
  const visible = state.approvals.filter((a) => isApprovalForView(a, state.activeSessionId));
  // Show ONE approval at a time (a FIFO queue), not all stacked. On a phone, stacked
  // question/approval cards pile up past the viewport and the lower ones became unreachable
  // (their Send/Deny buttons sat off-screen, so a second prompt was effectively unanswerable).
  // The head of the queue renders; answering it (resolveApproval removes it) advances to the
  // next. A "1 / N" counter signals more are waiting — desktop-style stepping.
  const head = visible[0];
  // A question (AskUserQuestion) needs room for its options + the Send button; the plain
  // yes/no approvals stay compact. Without the taller cap the question card clipped and the
  // Send button was unreachable (couldn't select or submit).
  const hasQuestion = head?.kind === "question" && (head.questions?.length ?? 0) > 0;
  return (
    <div
      ref={rootRef}
      className={`flex flex-col gap-2 overflow-y-auto px-3 pt-2 ${visible.length === 0 ? "hidden" : ""}`}
      style={{ maxHeight: hasQuestion ? "calc(var(--vvh, 100dvh) * 0.62)" : "calc(var(--vvh, 100dvh) * 0.5)" }}
    >
      {visible.length > 1 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="an-appr-count" style={{ color: "var(--an-fg-dim)" }}>1 / {visible.length}</span>
          <span className="an-appr-count" style={{ color: "var(--an-fg-mute)", fontWeight: 400 }}>
            {visible.length - 1} more waiting
          </span>
        </div>
      )}
      {head &&
        (head.kind === "question" && head.questions?.length ? (
          <QuestionCard key={head.id} req={head} onAnswer={(a) => decide(head, "once", { questionResponses: a })} />
        ) : (
          <ApprovalCard key={head.id} req={head} onDecide={(o, extra) => decide(head, o, extra)} />
        ))}
    </div>
  );
}

function DangerGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.6 10.7 10H1.3L6 1.6Z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6 4.6v2.5M6 8.7h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ReadGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2.2 2.2h8.6v8.6H2.2V2.2Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.1 4.5h4.8M4.1 6.5h4.8M4.1 8.5h3.2" stroke="currentColor" strokeWidth="1" strokeLinecap="square" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M3 9.9 3.6 7.4 8.9 2.1l1.9 1.9-5.3 5.3L3 9.9Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7.7 3.3 9.6 5.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
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
    <div className="an-appr text-sm">
      {questions.map((q, qi) => (
        <div
          key={qi}
          className="px-3.5 py-3"
          style={{ borderTop: qi === 0 ? undefined : "1px solid color-mix(in srgb, var(--brk) 22%, transparent)" }}
        >
          {q.header && <div className="an-appr-chip mb-2.5">{q.header}</div>}
          <div className="mb-2.5 font-bold" style={{ color: "var(--an-fg)" }}>{q.question}</div>
          {q.options.length > 0 && (
            <div className="flex flex-col gap-2">
              {q.options.map((opt) => {
                const chosen = (selections[qi] ?? []).includes(opt.label);
                const multi = q.multiSelect === true;
                return (
                  <button
                    key={opt.label}
                    onClick={() => toggle(qi, opt.label, multi)}
                    className={`an-appr-opt ${chosen ? "is-on" : ""}`}
                    aria-pressed={chosen}
                  >
                    <div className="flex items-center gap-2.5">
                      {multi && (
                        <span className={`an-appr-check ${chosen ? "is-on" : ""}`} aria-hidden="true" />
                      )}
                      <span className="font-bold" style={{ color: "var(--an-fg)" }}>{opt.label}</span>
                    </div>
                    {opt.description && (
                      <div className="mt-1 text-xs leading-snug" style={{ color: "var(--an-fg-dim)" }}>{opt.description}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {q.allowCustomInput && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              <div className="text-xs" style={{ color: "var(--an-fg-dim)" }}>
                {q.options.length > 0 ? "Or type your own answer" : "Type your answer"}
              </div>
              {q.secret ? (
                <input
                  type="password"
                  value={customInput[qi] ?? ""}
                  onChange={(e) => setTypedAnswer(qi, e.target.value)}
                  placeholder="Type your answer…"
                  className="an-appr-field"
                  style={{ letterSpacing: "2px" }}
                />
              ) : (
                <textarea
                  rows={3}
                  value={customInput[qi] ?? ""}
                  onChange={(e) => setTypedAnswer(qi, e.target.value)}
                  placeholder="Type your answer…"
                  className="an-appr-field resize-y"
                />
              )}
            </div>
          )}
        </div>
      ))}
      <div className="sticky bottom-0 px-3.5 py-3" style={{ background: "var(--brk-bg)" }}>
        <button disabled={!allAnswered} onClick={submit} className="an-appr-send">
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
  // Skill MARKET approvals get the "forge" treatment (twinkling stars + glow). Publishing
  // (make) glows violet with a name/description/price body; buying glows gold (the collectible
  // accent) so acquiring a skill feels like opening a treasure. Every other approval stays green.
  const isPublish = /publish_skill/.test(req.tool || "") || /publish_skill/.test(req.title || "");
  const isBuy = /buy_skill/.test(req.tool || "") || /buy_skill/.test(req.title || "");
  const isForge = isPublish || isBuy;
  const forgeAccent = isBuy ? "var(--an-amber)" : "var(--an-violet)";
  const buyName = req.input?.name as string | undefined;
  const forgeName = (req.input?.name as string) || "new skill";
  const forgeDesc = req.input?.description as string | undefined;
  const forgePrice = (() => {
    const p = req.input?.priceSol;
    return p == null ? "0.1 SOL" : String(p) === "0" ? "free" : `${p} SOL`;
  })();
  const [editMode, setEditMode] = useState(false);
  const [editedCmd, setEditedCmd] = useState(req.command ?? "");
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const { savePlan, send, resolveApproval } = useStore();

  // Plan cards: Enter = approve, Escape = save plan to log + keep planning (Claude Code parity)
  useEffect(() => {
    if (!isPlan) return;
    cardRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onDecide("once"); }
      if (e.key === "Escape") {
        e.preventDefault();
        if (req.plan) savePlan(req.plan);
        resolveApproval(req.id);
        send({ type: "interrupt" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlan]);

  // Every approval card announces itself; forge (on-chain publish/buy) hits harder.
  const lastBuzzedReq = useRef<string | null>(null);
  useEffect(() => {
    if (req.id !== lastBuzzedReq.current) {
      lastBuzzedReq.current = req.id;
      (isForge ? haptics.strong : haptics.press)();
    }
  }, [req.id, isForge]);

  // Terminal-skin variant: danger keeps green buttons but a red frame; buy = amber forge,
  // publish = violet forge. --brk-bg stays near-opaque
  // (composer-glass level) so chat content doesn't show through the card.
  const variantClass = isDanger ? "is-danger" : isBuy ? "is-amber" : isPublish ? "is-violet" : "";

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className={`an-appr ${variantClass} text-sm outline-none ${isForge ? "skill-forge" : ""} ${isBuy ? "is-buy" : ""}`}
    >
      {isForge && <ForgeStars accent={forgeAccent} />}
      {/* header */}
      <div className="relative z-10 flex items-center gap-2 px-3.5 pt-2.5 pb-1.5">
        {isDanger && (
          <span className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--an-red)", fontSize: "11px", letterSpacing: "0.5px" }}>
            <DangerGlyph />
            DANGER
          </span>
        )}
        <span className="inline-flex items-center font-bold" style={{ color: isForge ? forgeAccent : "var(--an-green)" }}>
          {isPlan || isForge ? (
            <SkillIcon className="h-4 w-4" />
          ) : req.kind === "bash" ? (
            "$"
          ) : req.kind === "read" ? (
            <ReadGlyph />
          ) : (
            <EditGlyph />
          )}
        </span>
        <span className="truncate font-bold" style={{ color: "var(--an-fg)" }}>{isPublish ? `Forge skill: ${forgeName}` : isBuy ? `Buy skill${buyName ? `: ${buyName}` : ""}` : req.title || req.tool}</span>
        <span className="ml-auto text-xs" style={{ color: "var(--an-fg-mute)" }}>{req.cli}</span>
        {/* bash: edit toggle */}
        {req.kind === "bash" && req.command && (
          <button
            onClick={() => setEditMode((e) => !e)}
            className="text-xs"
            style={{ color: "var(--an-fg-mute)" }}
          >
            {editMode ? "cancel" : "edit"}
          </button>
        )}
      </div>

      {/* detail */}
      {req.command && !editMode && (
        <pre
          className="overflow-auto px-3.5 pb-3 font-mono text-xs"
          style={{ color: "var(--an-fg-dim)", lineHeight: 1.55, maxHeight: "calc(var(--vvh, 100dvh) * 0.32)" }}
        >
          {req.command}
        </pre>
      )}
      {req.kind === "bash" && editMode && (
        <textarea
          value={editedCmd}
          onChange={(e) => setEditedCmd(e.target.value)}
          rows={3}
          className="an-appr-div w-full resize-y px-3.5 py-2.5 font-mono text-xs outline-none"
          style={{ background: "color-mix(in srgb, var(--an-bg-0) 82%, transparent)", color: "var(--an-fg)" }}
        />
      )}
      {req.plan && (
        <div
          className="overflow-y-auto whitespace-pre-wrap px-3.5 pb-3 text-xs leading-relaxed [overflow-wrap:anywhere]"
          style={{ color: "var(--an-fg-dim)", maxHeight: "min(16rem, max(8rem, calc(var(--vvh, 100dvh) * 0.36)))" }}
        >
          {req.plan}
        </div>
      )}
      {req.file && !req.diff && (
        <div className="px-3.5 pb-3 font-mono text-xs" style={{ color: "var(--an-fg-dim)" }}>{req.file}</div>
      )}
      {isPublish && (
        // What is being forged: name + description + price, so the approval is meaningful.
        // (Buy has no such input; its command line already names the skill.)
        <div className="relative z-10 px-3.5 pb-3">
          <div className="text-sm font-bold" style={{ color: "var(--an-fg)" }}>{forgeName}</div>
          {forgeDesc && <div className="mt-0.5 text-xs leading-snug" style={{ color: "var(--an-fg-dim)" }}>{forgeDesc}</div>}
          <div className="mt-1.5 text-xs" style={{ color: "var(--an-fg-mute)" }}>mint a soulbound NFT / price {forgePrice}</div>
        </div>
      )}
      {req.diff && (
        <pre
          className="overflow-auto px-3.5 pb-3 font-mono text-xs"
          style={{ maxHeight: "calc(var(--vvh, 100dvh) * 0.32)" }}
        >
          {req.diff.split("\n").map((ln, i) => (
            <div
              key={i}
              style={{
                color:
                  ln[0] === "+"
                    ? "var(--an-green)"
                    : ln[0] === "-"
                      ? "var(--an-red)"
                      : "var(--an-fg-mute)",
              }}
            >
              {ln}
            </div>
          ))}
        </pre>
      )}

      {/* deny-with-reason input: mobile-friendly full-width multiline field with
          full-size action buttons below, so the reason is easy to type and the buttons are
          comfortable tap targets (the old single-line text-xs row was too small on a phone). */}
      {showReason && (
        <div className="an-appr-div flex flex-col gap-2.5 px-3.5 py-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for denying (optional)"
            autoFocus
            rows={2}
            className="an-appr-field resize-y"
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter submits; plain Enter inserts a newline (mobile keyboard friendly).
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onDecide("deny", { reason: reason.trim() || undefined });
              if (e.key === "Escape") { setShowReason(false); setReason(""); }
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => onDecide("deny", { reason: reason.trim() || undefined })}
              className="an-appr-btn"
              style={{
                flex: "2 1 0",
                background: "color-mix(in srgb, var(--an-red) 24%, var(--an-bg-0))",
                color: "color-mix(in srgb, var(--an-red) 55%, var(--an-fg))",
              }}
            >
              Deny
            </button>
            <button
              onClick={() => { setShowReason(false); setReason(""); }}
              className="an-appr-btn"
              style={{ borderColor: "color-mix(in srgb, var(--an-fg) 25%, transparent)", color: "var(--an-fg-dim)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* action buttons: equal width, single row; primary action filled, the rest ghost
          (outline) so the card reads cleanly and the main choice stands out. z-10 keeps them
          above the skill-effect overlay. */}
      <div className="an-appr-div relative z-10 flex gap-2 px-3 py-2.5">
        {isPlan ? (
          <>
            <button autoFocus onClick={() => onDecide("once")} className="an-appr-btn an-appr-btn--primary whitespace-nowrap">
              Approve plan
            </button>
            <button onClick={() => { if (req.plan) savePlan(req.plan); onDecide("deny"); }} className="an-appr-btn an-appr-btn--deny whitespace-nowrap">
              Keep planning
            </button>
          </>
        ) : editMode ? (
          <>
            <button
              autoFocus
              onClick={() => onDecide("once", { updatedInput: { ...(req.input ?? {}), command: editedCmd } })}
              className="an-appr-btn an-appr-btn--primary whitespace-nowrap"
            >
              Approve edited
            </button>
            <button
              onClick={() => setEditMode(false)}
              className="an-appr-btn whitespace-nowrap"
              style={{ borderColor: "color-mix(in srgb, var(--an-fg) 25%, transparent)", color: "var(--an-fg-dim)" }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button autoFocus onClick={() => onDecide("once")} className="an-appr-btn an-appr-btn--primary whitespace-nowrap">
              Approve
            </button>
            <button onClick={() => onDecide("always")} className="an-appr-btn an-appr-btn--always whitespace-nowrap">
              Always
            </button>
            <button
              onClick={() => { setShowReason((s) => !s); }}
              className="an-appr-btn an-appr-btn--deny whitespace-nowrap"
            >
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// A handful of slow violet twinkles scattered over the forge card. Positions/timing are
// randomized once on mount so each forge card looks a little different (parity with the
// vscode forgeStars). Decorative, never intercepts taps.
function ForgeStars({ accent = "var(--an-violet)" }: { accent?: string }) {
  const stars = useRef(
    Array.from({ length: 6 }, () => ({
      left: 8 + Math.random() * 84,
      top: 12 + Math.random() * 70,
      dur: 3.2 + Math.random() * 2.4,
      delay: Math.random() * 3,
      size: 7 + Math.random() * 5,
    })),
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {stars.current.map((s, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          fill={accent}
          className="forge-star absolute"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDuration: `${s.dur}s`,
            animationDelay: `${s.delay}s`,
          }}
        >
          <path d="M12 2 14.4 9.6 22 12 14.4 14.4 12 22 9.6 14.4 2 12 9.6 9.6Z" />
        </svg>
      ))}
    </div>
  );
}
