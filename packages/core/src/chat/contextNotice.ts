import type { EngineKey } from "../runtime/engineRegistry.js";

// Shared by the terminal and host-dispatched /context command. These are the
// engine's last reported snapshot, not cumulative billing or a compaction forecast.
export function contextNotice(cli: EngineKey, used?: number, reportedWindow?: number): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const window = cli !== "custom" && reportedWindow && Number.isFinite(reportedWindow) && reportedWindow > 0 ? reportedWindow : undefined;
  if (used === undefined) return `Context (${cli}): usage not reported yet. ${window ? `Model context limit ${fmt(window)}.` : "Model context limit unknown."}`;
  if (!window) return `Context (${cli}): ${fmt(used)} tokens last reported. Model context limit unknown.`;
  return `Context snapshot (${cli})\n`
    + `  used    ${fmt(used)} / ${fmt(window)} (${Math.round((used / window) * 100)}%)\n`
    + `  free    ${fmt(Math.max(0, window - used))}`;
}
