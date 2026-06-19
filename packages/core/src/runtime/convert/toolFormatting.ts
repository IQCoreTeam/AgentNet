import type { ChatMessage } from "../contract.js";

export function displayFileName(path?: string): string {
  return path ? path.split("/").pop() || path : "";
}

export function codexFileChangeMessage(change: {
  path?: unknown;
  kind?: unknown;
  diff?: unknown;
}): ChatMessage | null {
  if (typeof change.path !== "string" || !change.path) return null;

  const kind = codexPatchKind(change.kind);
  const diff = typeof change.diff === "string" && change.diff.length > 0 ? change.diff : undefined;
  const action = kind === "delete" ? "Delete" : kind === "add" ? "Write" : "Edit";

  return {
    role: "tool",
    text: `${action} ${displayFileName(change.path)}`,
    ts: Date.now(),
    tool: { name: action, file: change.path, ...(diff ? { diff } : {}) },
  };
}

function codexPatchKind(kind: unknown): "add" | "delete" | "update" {
  if (kind === "add" || kind === "delete" || kind === "update") return kind;
  if (kind && typeof kind === "object" && "type" in kind) {
    const type = (kind as { type?: unknown }).type;
    if (type === "add" || type === "delete" || type === "update") return type;
  }
  return "update";
}
