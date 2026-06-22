// `window.AgentNetShell` type is declared in ./agentService (one canonical declaration).
export function openExternalUrl(url: string): void {
  if (typeof window.AgentNetShell?.openUrl === "function") {
    window.AgentNetShell.openUrl(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}
