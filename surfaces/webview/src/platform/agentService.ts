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
      setAgentActive?(active: boolean, clientId: string): void;
      // Raise an approval notification (shell no-ops it when foreground). Its Approve/
      // Reject actions POST an approvalDecision to /rpc?client=<clientId>.
      requestApproval?(id: string, title: string, clientId: string, body: string): void;
      // First time the user enables background exec: prompt for battery-optimization
      // exemption so Android doesn't reap a long task. Guarded native-side against nagging.
      onBackgroundEnabled?(): void;
    };
  }
}

const KEY = "agentnet.backgroundExec";

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

// Default-on means the user never taps the toggle, so the one-time battery-exemption prompt
// (normally fired on enable) wouldn't show. Call this once on launch so a default-on user
// still gets it. The shell guards against nagging, so repeat calls are safe no-ops.
export function ensureBackgroundConsent(): void {
  if (backgroundExecEnabled()) window.AgentNetShell?.onBackgroundEnabled?.();
}

export function setBackgroundExecEnabled(on: boolean, clientId: string | null): void {
  localStorage.setItem(KEY, on ? "1" : "0");
  if (on) window.AgentNetShell?.onBackgroundEnabled?.();
  else window.AgentNetShell?.setAgentActive?.(false, clientId ?? ""); // demote at once when off
}

// Reflect agent activity to the shell. Promotes only when background exec is enabled AND a
// turn is active; otherwise demotes so the idle process can be reclaimed.
export function syncAgentService(active: boolean, clientId: string | null): void {
  window.AgentNetShell?.setAgentActive?.(active && backgroundExecEnabled(), clientId ?? "");
}

// Ask the shell to surface a pending approval (it decides notify-vs-ignore by its own
// foreground state).
export function notifyApproval(id: string, title: string, clientId: string | null, body?: string): void {
  window.AgentNetShell?.requestApproval?.(id, title, clientId ?? "", body ?? "");
}
