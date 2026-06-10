// WebviewApprovalChannel — the webview-button implementation of ApprovalChannel.
// When an engine needs a tool approved, request() posts an "approval" message to the
// chat webview, stores the pending resolver keyed by request id, and awaits the
// user's click. The webview answers with {type:"approvalDecision", id, outcome};
// extension.ts routes that to resolve(). One channel instance lives for the whole
// extension; it points at whatever chat panel is currently open (rebindable), so the
// same channel survives panel re-creation — and could later forward to a phone push.

import * as vscode from "vscode";
import type { ApprovalChannel, ApprovalRequest, ApprovalDecision } from "@iqlabs-official/agent-sdk";

export class WebviewApprovalChannel implements ApprovalChannel {
  private panel: vscode.WebviewPanel | null = null;
  private pending = new Map<string, (d: ApprovalDecision) => void>();

  // Point the channel at the live chat panel. Call on panel create; pass null on
  // dispose. Any requests still pending when the panel goes away auto-deny (the user
  // can't answer a closed panel — better to fail safe than hang the engine).
  bind(panel: vscode.WebviewPanel | null) {
    if (!panel) this.drain("deny");
    this.panel = panel;
  }

  // Called by extension.ts when the webview posts an approval decision.
  resolve(id: string, decision: ApprovalDecision) {
    const r = this.pending.get(id);
    if (!r) return;
    this.pending.delete(id);
    r(decision);
  }

  async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    // no panel to ask → auto-deny (safe default; never block the engine forever)
    if (!this.panel) return { outcome: "deny", reason: "No UI to approve" };
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(req.id, resolve);
      this.panel!.webview.postMessage({ type: "approval", req });
    });
  }

  private drain(outcome: ApprovalDecision["outcome"]) {
    for (const [, r] of this.pending) r({ outcome, reason: "Panel closed" });
    this.pending.clear();
  }
}
