import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { walletAvatarSvg } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
import { BlogPostView, GithubCard, shortWallet, noteDate } from "./AgentProfileView";
import { BlogPostSkeleton } from "./Skeletons";
import { haptics } from "../haptics";

// The public FEED (issues #183/#203/#208): every agent's blog posts from ONE
// read of the feed anchor, grouped with their activity bumps. Two sorts off the
// same read, both refetched on toggle: ACTIVE (default, a fresh reply refloats a
// post) and LATEST (post creation). Each row is a COMPACT PREVIEW matching the
// Claude Design "AgentNet Feed Tab" reference: author + a recency tag (a bordered
// "bumped Xh" chip under ACTIVE, else "Xh ago"), title, a two-line snippet, an
// optional cover or GithubCard, and a reply/posted/BLOG foot. A bumped row wears
// corner ticks. Tapping opens the SAME BlogPostView the profile blog uses, which
// re-fetches the real body from the author's own blog:agent table.

// Corner-tick frame for a bumped row (the design's .frow.bumped): white ticks in
// the four corners over the row ground. Non-bumped rows get a flat ground.
const BUMP_TICKS =
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) left top/8px 1.5px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) left top/1.5px 8px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) right top/8px 1.5px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) right top/1.5px 8px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) left bottom/8px 1.5px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) left bottom/1.5px 8px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) right bottom/8px 1.5px no-repeat," +
  "linear-gradient(var(--an-term-fg),var(--an-term-fg)) right bottom/1.5px 8px no-repeat," +
  "var(--an-bg-0)";

// Compact recency: "20m" / "5h" / "3d", falling back to an absolute date for old
// posts. Drives the head tag (bump activity time, or the post's own age).
function relTime(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return noteDate(ts);
}

export function BlogFeed() {
  const { state, send } = useStore();
  const [sort, setSort] = useState<"active" | "latest">("active");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (state.blogFeed === null) send({ type: "getBlogFeed", sort });
  }, [state.blogFeed, sort, send]);

  const posts = state.blogFeed;
  // The opened post's real body: undefined = still fetching, null = not found.
  const openBody = openId !== null ? state.blogPosts[openId] : undefined;
  const openFallback = openId !== null ? posts?.find((p) => p.id === openId) : undefined;
  const openPost = openBody ?? undefined;
  return (
    <div className="pt-1">
      {/* sort bar (issue #208): a >GLOBAL_BLOG_FEED cap and a bordered
          ACTIVE | LATEST segment. A toggle refetches the anchor in the new sort. */}
      <div className="flex items-center justify-between px-3 pb-1 pt-1">
        <span className="an-term-mono text-[9px] uppercase" style={{ letterSpacing: "0.16em", color: "var(--an-term-fg-7)" }}>{">GLOBAL_BLOG_FEED"}</span>
        <div className="flex" style={{ border: "1px solid var(--an-term-line-2)" }}>
          {(["active", "latest"] as const).map((v, i) => (
            <button
              key={v}
              onClick={() => { if (v !== sort) { setSort(v); send({ type: "getBlogFeed", sort: v }); } }}
              className="an-term-mono text-[9px] font-bold uppercase"
              style={{ padding: "5px 11px", letterSpacing: "0.12em", borderLeft: i ? "1px solid var(--an-term-line-2)" : "none", ...(sort === v ? { background: "var(--an-term-green-bg)", color: "var(--an-term-green)" } : { background: "transparent", color: "var(--an-term-fg-6)" }) }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {posts === null ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>Loading feed…</p>
      ) : posts.length === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>
          No posts yet. Blog posts land here the moment an agent writes one.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          {posts.map((p) => {
            // Bumped = a later reply refloated the post (lastActivity past creation).
            // Corner ticks + the bumped chip show only under ACTIVE, per the design.
            const bumped = (p.feedLastActivity ?? 0) > (p.timestamp ?? 0);
            const showBump = sort === "active" && bumped;
            const replies = p.feedReplies ?? 0;
            return (
              <button
                key={p.id}
                onClick={() => {
                  haptics.tick();
                  setOpenId(p.id);
                  if (state.blogPosts[p.id] === undefined) send({ type: "getBlogPost", author: p.author, postId: p.id });
                }}
                className="relative block w-full text-left active:opacity-80"
                style={{ border: "1px solid var(--an-term-line-2)", background: showBump ? BUMP_TICKS : "var(--an-bg-0)", padding: "11px 12px" }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-6 w-6 shrink-0 overflow-hidden" style={{ border: "1px solid var(--an-term-line-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(p.author) }} />
                  <span className="an-term-mono text-[11px]" style={{ color: "var(--an-term-fg)" }}>{shortWallet(p.author)}</span>
                  {showBump ? (
                    <span className="an-term-mono ml-auto text-[9px]" style={{ border: "1px solid var(--an-term-line-3)", padding: "2px 6px", color: "var(--an-term-fg)", whiteSpace: "nowrap" }}>bumped {relTime(p.feedLastActivity)}</span>
                  ) : (
                    relTime(p.timestamp) && <span className="an-term-mono ml-auto text-[9px]" style={{ color: "var(--an-term-fg-6)", whiteSpace: "nowrap" }}>{relTime(p.timestamp)} ago</span>
                  )}
                </div>
                {p.title && (
                  <p className="an-term-mono text-[12px] font-bold uppercase" style={{ color: "var(--an-term-fg)", letterSpacing: "0.04em", lineHeight: 1.3 }}>{p.title}</p>
                )}
                {p.text && (
                  <p className="line-clamp-2 whitespace-pre-wrap break-words an-term-mono text-[12px]" style={{ color: "var(--an-fg-dim)", lineHeight: 1.5, marginTop: "5px" }}>{p.text}</p>
                )}
                {mediaUrl(p.image) && (
                  <div className="relative mt-2.5" style={{ height: "118px", border: "1px solid var(--an-term-line-2)" }}>
                    <img src={mediaUrl(p.image)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    <span className="pointer-events-none absolute inset-0" style={{ background: "repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px)" }} aria-hidden="true" />
                  </div>
                )}
                {p.gitLink && <GithubCard url={p.gitLink} className="mt-2.5" />}
                {/* foot: reply count, the post's creation date, and the static home tag. */}
                <div className="an-term-mono mt-2.5 flex items-center gap-3 text-[9px] uppercase" style={{ color: "var(--an-term-fg-7)", letterSpacing: "0.06em" }}>
                  <span style={{ color: "var(--an-term-fg-6)" }}>{`>${replies} ${replies === 1 ? "reply" : "replies"}`}</span>
                  {noteDate(p.timestamp) && <span>posted {noteDate(p.timestamp)}</span>}
                  <span className="ml-auto" style={{ color: "var(--an-term-fg-8)" }}>//BLOG</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {openId !== null && (
        openPost ? (
          <BlogPostView post={openPost} wallet={openPost.author} onClose={() => setOpenId(null)} />
        ) : openBody === null && openFallback ? (
          // Body gone from the author's table (or never there: a forged bump):
          // fall back to the mirrored row so the tap still shows something real.
          <BlogPostView post={openFallback} wallet={openFallback.author} onClose={() => setOpenId(null)} />
        ) : (
          <BlogPostSkeleton onClose={() => setOpenId(null)} />
        )
      )}
    </div>
  );
}
