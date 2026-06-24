// Live-only, in-memory image cache for the CURRENT session's chat log.
//
// We deliberately never persist the image bytes: the encrypted chat log stores only an
// imageCount (keeps the log small and cheap to sync to Drive). So attached images render as
// thumbnails while their session is on screen, and are dropped on reload or session switch
// (a reloaded message keeps its count but loses the picture). That is the intended trade-off.
//
// Association: on send we queue the dataUrls; when the server echoes the user message back
// with its assigned `ts`, we pair the front of the queue to that ts (FIFO == send order).

let pending: string[][] = []; // dataUrls per sent turn, oldest first
const byTs = new Map<number, string[]>(); // ts -> dataUrls, once associated
const decided = new Set<number>(); // ts values we've already ruled on (seen once)
let session = "";
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

// Composer calls this on submit, before it clears its own attachments.
export function enqueueLiveImages(dataUrls: string[]): void {
  if (dataUrls.length) pending.push(dataUrls);
}

// Drop everything when the visible session changes (live data doesn't carry over).
export function syncLiveSession(sessionId: string): void {
  if (sessionId === session) return;
  session = sessionId;
  pending = [];
  byTs.clear();
  decided.clear();
  notify();
}

// Decide, once per message, whether it owns queued live images. A message is ruled on the
// FIRST time it's seen: if a send is in flight (pending non-empty) it claims the front of the
// queue, otherwise it's left imageless forever. This is what keeps a freshly attached image
// from latching onto an OLD history message that also carries an imageCount — on load every
// existing message is seen with an empty queue and permanently marked imageless, so only the
// message that appears AFTER the next send (when pending is non-empty) can claim it.
export function associateLiveImages(ts: number): void {
  if (decided.has(ts)) return;
  decided.add(ts);
  const next = pending.shift();
  if (next) {
    byTs.set(ts, next);
    notify();
  }
}

export function liveImagesFor(ts: number | undefined): string[] | undefined {
  return ts == null ? undefined : byTs.get(ts);
}

export function subscribeLiveImages(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
