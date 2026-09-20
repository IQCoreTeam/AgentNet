// `window.AgentNetShell` type is declared in ./agentService (one canonical declaration).
export function openExternalUrl(url: string): void {
  if (typeof window.AgentNetShell?.openUrl === "function") {
    window.AgentNetShell.openUrl(url);
    return;
  }
  // noopener makes window.open return null even when it succeeds, so it cannot
  // distinguish a blocked popup. Open an empty tab, sever its opener, then navigate.
  const opened = window.open("about:blank", "_blank");
  if (opened) {
    opened.opener = null;
    // Navigate through a noreferrer link to preserve the original referrer policy.
    const link = opened.document.createElement("a");
    link.href = url;
    link.rel = "noreferrer";
    link.click();
  } else {
    window.location.assign(url);
  }
}
