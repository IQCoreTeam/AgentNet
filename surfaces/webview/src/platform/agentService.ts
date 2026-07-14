// Bridge to the Android shell's background-execution control (issue #53). On desktop /
// browser `window.AgentNetShell` is absent, so every call here is a no-op. The shell only
// keeps its foreground service (and thus the proot node runtime) alive while a turn is
// ACTIVE *and* the user opted into background execution — so we drive it from turn state,
// not on app launch. Idle ⇒ no service ⇒ Android reclaims the process normally.
//
// The shell's notification actions (Stop / Approve / Reject) POST back to the loopback
// server's /rpc, which needs the SSE client id to route — so we pass it on every call.
declare global {
  interface Window {
    AgentNetShell?: {
      openUrl?(url: string): void;
      // Promote (true) / demote (false) the foreground service. `clientId` lets the
      // persistent notification's Stop action reach /rpc.
      setAgentActive?(active: boolean, clientId: string, keepWhileLocked: boolean): void;
      // Raise an approval notification. `sessionId` lets a tap deep-link to that chat.
      // `force` = notify even in foreground (the request is for a session the user isn't
      // viewing — chat-app style ping). When force is false the shell still no-ops in
      // foreground (the WebView's own dock shows it). `isQuestion` = AskUserQuestion: shown
      // without Approve/Reject actions (answered by tapping in, not from the notification).
      // Its Approve/Reject actions POST an approvalDecision to /rpc?client=<clientId>.
      requestApproval?(id: string, title: string, clientId: string, body: string, sessionId: string, force: boolean, isQuestion: boolean): void;
      // Drop the approval notification once the user is viewing its chat (or it's answered),
      // the way a chat app clears a conversation's alert when you open the thread.
      clearApprovalNotice?(): void;
      // First time the user enables background exec: prompt for battery-optimization
      // exemption so Android doesn't reap a long task. Guarded native-side against nagging.
      onBackgroundEnabled?(): void;
      // Raise a softer completion alert when the display is off.
      notifyTurnComplete?(sessionId: string): void;
    };
  }
}

const KEY = "agentnet.backgroundExec";
const LOCKED_KEY = "agentnet.keepWorkingLocked";

// Only true inside the Android shell — gates the settings toggle's visibility.
export function hasAgentService(): boolean {
  return typeof window.AgentNetShell?.setAgentActive === "function";
}

// Default ON: an agent task left running when you leave the app keeps going + notifies.
// Still only promotes the service while a turn is ACTIVE, so idle never holds the process.
// Off only when the user explicitly turned it off.
export function backgroundExecEnabled(): boolean {
  return localStorage.getItem(KEY) !== "0";
}

// Screen-off execution is deliberately opt-in and cannot outlive its background-execution
// dependency. Missing storage means OFF.
export function screenOffExecEnabled(): boolean {
  return backgroundExecEnabled() && localStorage.getItem(LOCKED_KEY) === "1";
}

// Default-on means the user never taps the toggle, so the one-time battery-exemption prompt
// (normally fired on enable) wouldn't show. Call this once on launch so a default-on user
// still gets it. The shell guards against nagging, so repeat calls are safe no-ops.
export function ensureBackgroundConsent(): void {
  if (backgroundExecEnabled()) window.AgentNetShell?.onBackgroundEnabled?.();
}

export function setBackgroundExecEnabled(on: boolean, active: boolean, clientId: string | null): void {
  localStorage.setItem(KEY, on ? "1" : "0");
  if (on) {
    window.AgentNetShell?.onBackgroundEnabled?.();
    window.AgentNetShell?.setAgentActive?.(active, clientId ?? "", screenOffExecEnabled());
  } else {
    localStorage.setItem(LOCKED_KEY, "0");
    window.AgentNetShell?.setAgentActive?.(false, clientId ?? "", false); // demote at once when off
  }
}

export function setScreenOffExecEnabled(on: boolean, active: boolean, clientId: string | null): void {
  const enabled = on && backgroundExecEnabled();
  localStorage.setItem(LOCKED_KEY, enabled ? "1" : "0");
  if (enabled) window.AgentNetShell?.onBackgroundEnabled?.();
  window.AgentNetShell?.setAgentActive?.(active && backgroundExecEnabled(), clientId ?? "", enabled);
}

// Reflect agent activity to the shell. Promotes only when background exec is enabled AND a
// turn is active; otherwise demotes so the idle process can be reclaimed.
export function syncAgentService(active: boolean, clientId: string | null): void {
  window.AgentNetShell?.setAgentActive?.(
    active && backgroundExecEnabled(),
    clientId ?? "",
    screenOffExecEnabled(),
  );
}

export function notifyTurnComplete(sessionId: string): void {
  if (screenOffExecEnabled()) window.AgentNetShell?.notifyTurnComplete?.(sessionId);
}

// Ask the shell to surface a pending approval. `force` makes it notify even in foreground
// — used when the approval belongs to a session the user isn't currently viewing, so it
// pings like a chat app instead of hijacking the open chat. `sessionId` lets a tap deep-link
// straight to that conversation.
export function notifyApproval(id: string, title: string, clientId: string | null, body: string, sessionId: string, force: boolean, isQuestion: boolean): void {
  window.AgentNetShell?.requestApproval?.(id, title, clientId ?? "", body ?? "", sessionId ?? "", force, isQuestion);
}

// Clear the approval notification — call when the user is viewing the chat the pending
// approval belongs to, or once no approval is pending (chat-app style: open the thread, the
// alert goes away). No-op off the Android shell.
export function clearApprovalNotice(): void {
  window.AgentNetShell?.clearApprovalNotice?.();
}
