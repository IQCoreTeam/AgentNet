// In-app preview: an agent (or the user) starts a dev server on a loopback port and
// announces it to the localhost server; the webview's PREVIEW tab then frames it.
// The HTTP route + SSE broadcast live in index.ts — this module holds the pure,
// unit-testable pieces so the validation and payload shape can be tested without
// booting the full chat server.

/**
 * Validate a port announced to POST /preview/announce.
 *  - `null`  → clear the current preview (valid).
 *  - a real loopback dev-server port → return it.
 *  - anything else → `false` (reject with 400).
 * `serverPort` is this server's own port (4317); it can never be a preview target
 * (that would frame AgentNet inside itself).
 */
export function validatePreviewPort(raw: unknown, serverPort: number): number | null | false {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return false;
  if (raw < 1 || raw > 65535 || raw === serverPort) return false;
  return raw;
}

/** The single source of truth for the `previewStatus` payload sent to the webview. */
export function previewStatusMsg(port: number | null) {
  return {
    type: "previewStatus" as const,
    port,
    url: port ? `http://127.0.0.1:${port}/` : null,
  };
}

/** True for the device's own loopback. `http.listen(PORT)` binds all interfaces, so the
 *  announce route rejects any non-loopback caller (it only changes which URL the tab shows,
 *  but there's no reason to accept it off-device). */
export function isLoopback(addr: string): boolean {
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("127.")
  );
}
