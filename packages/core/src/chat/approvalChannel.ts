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
  private pending = new Map<string, (d: ApprovalDecision) => void>();

  // The transport is shared with the chat dispatcher (same pipe). We subscribe for
  // OUR message type only and ignore the rest — onRecv fan-out is fine because the
  // dispatcher's switch has no "approvalDecision" case (this channel owns it).
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
    });
  }

  async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(req.id, resolve);
      this.transport.send({ type: "approval", req });
    });
  }

  private resolve(id: string, decision: ApprovalDecision) {
    const r = this.pending.get(id);
    if (!r) return;
    this.pending.delete(id);
    r(decision);
  }

  // Auto-deny anything still pending — used when the UI goes away (closed panel /
  // dropped socket): a request no one can answer must fail safe, not hang the engine.
  drain(reason = "UI closed") {
    for (const [, r] of this.pending) r({ outcome: "deny", reason });
    this.pending.clear();
  }
}
