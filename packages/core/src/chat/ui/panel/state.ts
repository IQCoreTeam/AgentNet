import type { CloudListState, SessionMeta } from "../../../runtime/contract.js";
import type { Note } from "../../../core/types.js";

// The panel's mutable state, one store. ESM import bindings are read-only and the message
// listener (main.ts) plus onMessage write state owned by many modules, so every top-level
// `let` of the legacy script lives here as S.<name>: every cross-module write is legal and a
// missed rewrite is a tsc "Cannot find name", never a silent global. Initializers and their
// comments are the legacy ones, in source order, grouped by the module that owns the field.
export const S = {
  // ---- shell.ts ----
  stick: true,
  hasNew: false, // new content arrived while scrolled up → light the button in the engine accent
  streaming: null as any, // bubble currently being streamed into
  streamRaf: 0, // rAF handle: coalesces live-markdown renders to one paint/frame
  streamTimer: 0, // trailing timer that defers the next render to the cadence boundary
  lastStreamRender: 0, // when the live bubble was last re-rendered
  // ---- sessions.ts ----
  allSessions: [] as SessionMeta[], // last sessions payload from extension
  cloudListState: 'none' as CloudListState, // cloud health of that payload's union (ok/reauth/transient/none)
  activeId: null as SessionMeta['sessionId'] | null | undefined,
  expanded: false, // "모두 보기" toggled?
  // ---- slash.ts ----
  slashIdx: 0,
  suppressSlash: false,
  activeSlashMatches: [] as any[],
  // ---- engine.ts ----
  cli: 'claude',
  cliReport: null as any,
  // ---- turns.ts ----
  tailTurn: null as any, // the turn new (bottom) replies attach to
  headTurn: null as any, // the turn prepended (top, older) replies attach to
  openBash: null as any, // a bash card awaiting its output (claude's split result)
  // ---- composer.ts ----
  typingEl: null as any,
  busy: false,
  attached: [] as any[],
  pendingSentImages: [] as any[],
  growRaf: 0,
  // ---- storage.ts ----
  storageOptions: [] as any[],
  cloudConnected: false,
  cloudKind: '', // which backend is connected, so a reauth prompt can reconnect the right one
  // ---- publish.ts ----
  pubKind: 'skill',
  pubBodyConfirmed: false,
  // ---- feed.ts ----
  currentProfileWallet: null as any,
  agentsTab: 'feed', // persists across view switches, same as profileTab
  feedSort: 'active', // ACTIVE = lastActivityTime, LATEST = createdAt
  feedPosts: null as Note[] | null, // null = never loaded (skeletons), [] = settled empty
  currentFeedPost: null as Note | null, // the post open in the reader
  feedLastSage: false, // whether the comment in flight was sage (skips the fresh re-read)
  feedReplyTo: null as Note['id'] | null, // id of the comment being answered (mobile CommentThreadList idiom)
  fabModalEl: null as any,
  // ---- quotes.ts ----
  quoteCards: {} as Record<string, HTMLDivElement[] | undefined>, // postId -> [placeholder card elements] awaiting the reply
  quoteSeen: {} as Record<string, true | undefined>, // postId -> true once carded in the current render pass
  quoteSlots: 0, // unique refs carded in the current render pass
  // ---- agents.ts ----
  lastAgents: [] as any[],
  recentlyPosted: [] as any[], // [{ wallet, note, ts }]
  pendingPost: null as any, // { wallet, text, gitLink, self } — stashed at submit for agentNoteResult
  postFeedback: null as any, // { wallet, text, ok, ts } — survives the immediate profile re-render
  profileTab: 'agent',
  // ---- profile.ts ----
  repoModalEl: null as any,
  // ---- skills.ts ----
  ownedSkills: [] as any[],
  skillMints: {} as any, // slug/name -> mint for bought NFT skills (reuse market detail)
  workflowMintSet: new Set<any>(), // owned mints that are workflows (excluded from the workflow picker)
  disposedMints: {} as any, // slug -> mint for un-pinned skills (greyed in the panel)
  disposedMintSet: new Set<any>(), // the mints above, for isDisposed() detail checks
  // ---- market.ts ----
  lastMarketResults: [] as any[], // last search results, kept to re-render on owned-list change
  currentKind: 'skill', // active tab: Skills | Workflows
  currentDetail: null as any, // { id, type } of the open detail — for comments refresh
  hideOwnedMarket: undefined as any,
  mktSort: undefined as any,
  skillModalOpen: false,
  skillModalBuyBtn: null as any,
  skillModalName: null as any,
  skillModalMint: null as any,
  skillDocOpen: false,
  currentDetailName: null as any,
  detailBuyBtn: null as any,
  // ---- overlays.ts ----
  celebTimer: null as any,
  solLamports: null as any, // last known balance (lamports); null = unknown/failed
  buyErrTimer: null as any,
  dasReady: false,
  rpcNetwork: 'devnet', // drives explorer-link cluster (set from rpcStatus)
  pick: 0, // rotate so the verb feels alive
  actTimer: null as any,
  firingTimer: null as any,
  // ---- wallet.ts ----
  myWalletAddress: null as any, // tracked so openWalletPage can showProfile(own)
  // ---- paging.ts ----
  pageCursor: null as any, // cursor for the NEXT older page (null = none / at start)
  hasMore: false, // older pages exist?
  loadingOlder: false,
  lastOlderCursor: null as any, // last cursor we asked for; never auto-request the same one twice
};
