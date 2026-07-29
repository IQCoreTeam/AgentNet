// TransportApprovalChannel — the button-driven ApprovalChannel, transport-neutral.
//
// Lifted out of vscode's WebviewApprovalChannel so every surface shares one
// implementation (CODE-RULES: don't fork per platform). When an engine needs a tool
// approved, request() sends an "approval" message down the transport, parks the
// resolver keyed by request id, and awaits the UI's answer. The UI sends back
// {type:"approvalDecision", id, outcome}; this channel subscribes to the transport
// itself and resolves the matching promise — so the chat dispatcher never has to
// know approvals exist. One channel per chat (per panel / per socket).

import type { ApprovalChannel, ApprovalRequest, ApprovalDecision } from "../runtime/approval/channel.js";
import type { ChatTransport } from "./session.js";

export class TransportApprovalChannel implements ApprovalChannel {
  private pending = new Map<string, { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void }>();

  // The transport is shared with the chat dispatcher (same pipe). We subscribe for
  // OUR message types only and ignore the rest — onRecv fan-out is fine because the
  // dispatcher's switch has no case for them (this channel owns them).
  constructor(private transport: ChatTransport) {
    transport.onRecv((m) => {
      if (m?.type === "approvalDecision" && typeof m.id === "string" && m.outcome) {
        this.resolve(m.id, {
          outcome: m.outcome,
          reason: m.reason,
          answers: m.answers,
          questionResponses: m.questionResponses,
        });
      }
      // UI re-sync (session switch / view reload): replay everything still parked here as
      // one authoritative snapshot. request() sends each approval exactly once, so a view
      // that missed the live event (or dropped it on a repaint) has no other way to learn
      // the engine is still blocked waiting on it.
      if (m?.type === "resendApprovals") {
        this.transport.send({ type: "approvalsSnapshot", reqs: [...this.pending.values()].map((p) => p.req) });
      }
    });
  }

  async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(req.id, { req, resolve });
      this.transport.send({ type: "approval", req });
    });
  }

  private resolve(id: string, decision: ApprovalDecision) {
    const r = this.pending.get(id);
    if (!r) return;
    this.pending.delete(id);
    r.resolve(decision);
  }

  // Auto-deny anything still pending — used when the UI goes away (closed panel /
  // dropped socket): a request no one can answer must fail safe, not hang the engine.
  drain(reason = "UI closed") {
    for (const [, p] of this.pending) p.resolve({ outcome: "deny", reason });
    this.pending.clear();
  }
}
