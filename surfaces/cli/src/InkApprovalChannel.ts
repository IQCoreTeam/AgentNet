import type {
  ApprovalChannel,
  ApprovalRequest,
  ApprovalDecision,
} from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import { callAttention, clearAttention } from "./notify.js";

// The CLI's implementation of the ApprovalChannel seam. The engine calls request() and
// awaits; we surface the pending request to the React layer (subscribe) and resolve the
// promise when the user presses a key (resolve). One pending at a time — engines block
// on a tool decision before asking for the next, so a single slot is enough.
type Pending = { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void };

export class InkApprovalChannel implements ApprovalChannel {
  private pending: Pending | null = null;
  private listener: ((req: ApprovalRequest | null) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  // Auto-deny an unanswered request after this long so a turn never blocks forever when
  // the user walks away (design tab 27: "nothing hangs forever"). This lives HERE rather
  // than in core's generic withTimeout() because the timeout must also clear the on-screen
  // card — resolve() does both — which a plain request()-wrapping combinator cannot.
  constructor(private readonly timeoutMs = 10 * 60 * 1000) {}

  request(req: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending = { req, resolve };
      this.listener?.(req);
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(
        () =>
          this.resolve(req.id, {
            outcome: "deny",
            reason: "Approval timed out. No response in 10 minutes.",
          }),
        this.timeoutMs,
      );
      // The turn is now blocked on a human. If that human is in another window they have
      // no way to know - the card is drawn on a terminal they are not looking at. The
      // escalated dialog carries Approve/Deny buttons; a click resolves right there.
      // resolve() checks the pending id, so a stale click after an in-terminal answer
      // (or the next request) lands on nothing.
      const summary =
        `${req.cli} wants to use ${req.tool}` +
        (req.command ? ` - ${req.command.slice(0, 80)}` : "");
      callAttention(summary, (approve) =>
        this.resolve(
          req.id,
          approve
            ? { outcome: "once" }
            : { outcome: "deny", reason: "denied from the popup dialog" },
        ),
      );
    });
  }

  // React subscribes to learn the current pending request (or null when cleared).
  subscribe(cb: (req: ApprovalRequest | null) => void): () => void {
    this.listener = cb;
    cb(this.pending?.req ?? null);
    return () => {
      if (this.listener === cb) this.listener = null;
    };
  }

  // UI answer → unblock the waiting engine.
  resolve(id: string, decision: ApprovalDecision): void {
    const p = this.pending;
    if (p && p.req.id === id) {
      this.pending = null;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      clearAttention();
      this.listener?.(null);
      p.resolve(decision);
    }
  }
}
