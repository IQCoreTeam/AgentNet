import type { EngineKey } from "../runtime/engineRegistry.js";

// Shared by the terminal and host-dispatched /context command.
export function contextNotice(cli: EngineKey, used?: number, reportedWindow?: number): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  // Custom runs through Codex, whose reported window may be its own fallback.
  // It is not evidence of the configured provider's capacity or compaction policy.
  if (cli === "custom") {
    return used === undefined
      ? "Context: usage not reported yet. Provider context limit unknown."
      : `Context (custom): ${fmt(used)} tokens used. Provider context limit unknown.`;
  }
  const window = reportedWindow ?? (cli === "claude" ? 200_000 : 256_000);
  if (used === undefined) return `Context: 0 / ${fmt(window)} tokens. Send a message to measure usage.`;
  const free = Math.max(0, window - used);
  const pct = Math.round((used / window) * 100);
  const threshold = Math.max(0, window - 33_000);
  const tpct = Math.round((threshold / window) * 100);
  return `Context window (${cli})\n`
    + `  used    ${fmt(used)} / ${fmt(window)} (${pct}%)\n`
    + `  free    ${fmt(free)}\n`
    + `  auto-compact at ~${fmt(threshold)} (${tpct}%)`;
}
