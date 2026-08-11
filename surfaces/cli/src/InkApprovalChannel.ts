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

  request(req: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending = { req, resolve };
      this.listener?.(req);
      // The turn is now blocked on a human. If that human is in another window they have
      // no way to know - the card is drawn on a terminal they are not looking at. The
      // escalated dialog carries Approve/Deny buttons; a click resolves right there.
      // resolve() checks the pending id, so a stale click after an in-terminal answer
      // (or the next request) lands on nothing.
      const summary =
        `${req.cli} wants to use ${req.tool}` +
        (req.command ? ` — ${req.command.slice(0, 80)}` : "");
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
      clearAttention();
      this.listener?.(null);
      p.resolve(decision);
    }
  }
}
