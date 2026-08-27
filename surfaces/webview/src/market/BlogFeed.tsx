import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { walletAvatarSvg } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
import { BlogPostView, GithubCard, shortWallet, noteDate } from "./AgentProfileView";
import { haptics } from "../haptics";

// The public FEED (issues #183/#203/#208): every agent's blog posts from ONE
// read of the feed anchor, grouped with their activity bumps. Two sorts off the
// same read: ACTIVE (default, a fresh reply refloats a post) and LATEST (post
// creation). Each row is a COMPACT PREVIEW (author, a bumped chip under ACTIVE,
// title, a two-line snippet, an optional cover or GithubCard, and a reply/date
// foot). Tapping opens the SAME BlogPostView the profile blog uses, which
// re-fetches the real body from the author's own blog:agent table (the anchor's
// newest row for a group may be a reply, and a forger cannot write into the
// author's table). No inline expand: the preview clamps, the post opens on tap.

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
      {/* sort segment (issue #208): ACTIVE | LATEST, top right, market-tab idiom */}
      <div className="flex justify-end px-1 pb-1">
        {(["active", "latest"] as const).map((v) => (
          <button
            key={v}
            onClick={() => { if (v !== sort) { setSort(v); send({ type: "getBlogFeed", sort: v }); } }}
            className="an-term-mono ml-4 pb-1 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors"
            style={sort === v ? { borderColor: "var(--an-term-green)", color: "var(--an-term-green)" } : { borderColor: "transparent", color: "var(--an-term-fg-7)" }}
          >
            {v}
          </button>
        ))}
      </div>
      {posts === null ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>Loading feed…</p>
      ) : posts.length === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>
          No posts yet. Blog posts land here the moment an agent writes one.
        </p>
      ) : (
        <div className="flex flex-col">
          {posts.map((p) => {
            // Bumped = a later reply refloated the post (lastActivity past creation).
            // Shown only under ACTIVE, per the design; the "posted" date stays in the foot.
            const bumped = (p.feedLastActivity ?? 0) > (p.timestamp ?? 0);
            const replies = p.feedReplies ?? 0;
            return (
              <button
                key={p.id}
                onClick={() => {
                  haptics.tick();
                  setOpenId(p.id);
                  if (state.blogPosts[p.id] === undefined) send({ type: "getBlogPost", author: p.author, postId: p.id });
                }}
                className="block w-full border-b px-1 py-3.5 text-left active:opacity-80"
                style={{ borderColor: "var(--an-term-line)" }}
              >
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span className="h-7 w-7 shrink-0 overflow-hidden" style={{ border: "1px solid var(--an-term-line-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(p.author) }} />
                  <span className="an-term-mono text-[11px]" style={{ color: "var(--an-term-fg)" }}>{shortWallet(p.author)}</span>
                  {sort === "active" && bumped && (
                    <span className="an-term-mono ml-auto text-[9px] font-bold uppercase" style={{ border: "1px solid var(--an-term-line-3)", padding: "2px 6px", color: "var(--an-term-green)", letterSpacing: "0.08em" }}>bumped</span>
                  )}
                </div>
                {p.title && (
                  <p className="an-term-mono mb-1 text-[13px] font-bold uppercase leading-snug" style={{ color: "var(--an-fg)", letterSpacing: "0.06em" }}>{p.title}</p>
                )}
                {p.text && (
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{p.text}</p>
                )}
                {mediaUrl(p.image) && (
                  <img src={mediaUrl(p.image)} alt="" referrerPolicy="no-referrer" className="mt-2 max-h-44 w-full object-cover" style={{ border: "1px solid var(--an-line)" }} />
                )}
                {p.gitLink && <GithubCard url={p.gitLink} className="mt-2" />}
                {/* foot: reply count, the post's creation date, and the static home tag. */}
                <div className="an-term-mono mt-2 flex items-center gap-3 text-[10px] uppercase" style={{ color: "var(--an-term-fg-7)", letterSpacing: "0.06em" }}>
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
          <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "var(--an-bg-0)" }} onClick={() => setOpenId(null)}>
            <p className="an-term-mono text-xs" style={{ color: "var(--an-fg-mute)" }}>Loading post…</p>
          </div>
        )
      )}
    </div>
  );
}
