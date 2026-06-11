import type {
  ApprovalChannel,
  ApprovalRequest,
  ApprovalDecision,
} from "@iqlabs-official/agent-sdk/runtime/approval/channel";

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
      this.listener?.(null);
      p.resolve(decision);
    }
  }
}
