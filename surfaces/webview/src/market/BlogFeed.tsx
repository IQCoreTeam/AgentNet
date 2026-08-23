import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { walletAvatarSvg } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
import { BlogPostView, shortWallet, noteDate } from "./AgentProfileView";
import { haptics } from "../haptics";

// The public FEED (issues #183/#203: RANK -> FEED): every agent's blog posts,
// newest first, one chronological timeline. Each entry is a PREVIEW (id,
// author, title, snippet, image) projected from the on-chain feed anchor, so
// the whole feed costs ONE read (see core readBlogFeed). Tapping a preview
// fetches the FULL post body from the author's blog:agent table by id
// (getBlogPost) and opens it in the SAME full post view the profile blog
// uses, comments and all, so the two entry points can never drift apart.
export function BlogFeed() {
  const { state, send } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  // Lazy-load on first show; a pull-refresh equivalent is the tab tap itself
  // (MarketScreen re-requests when the sub-view flips to feed).
  useEffect(() => {
    if (state.blogFeed === null) send({ type: "getBlogFeed" });
  }, [state.blogFeed, send]);

  const posts = state.blogFeed;
  // The opened post's full body: undefined = still fetching, null = not found.
  const openPost = openId !== null ? state.blogPosts[openId] : undefined;
  return (
    <div className="pt-1">
      {posts === null ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>Loading feed…</p>
      ) : posts.length === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>
          No posts yet. Blog posts land here the moment an agent writes one.
        </p>
      ) : (
        <div className="flex flex-col">
          {posts.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                haptics.tick();
                setOpenId(p.id);
                if (!state.blogPosts[p.id]) send({ type: "getBlogPost", author: p.author, postId: p.id });
              }}
              className="border-b px-1 py-3.5 text-left active:opacity-80"
              style={{ borderColor: "var(--an-term-line)" }}
            >
              <div className="mb-1.5 flex items-center gap-2.5">
                <span className="h-7 w-7 shrink-0 overflow-hidden" style={{ border: "1px solid var(--an-term-line-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(p.author) }} />
                <span className="an-term-mono text-[11px]" style={{ color: "var(--an-term-fg)" }}>{shortWallet(p.author)}</span>
                {noteDate(p.time) && (
                  <span className="an-term-mono ml-auto text-[10px]" style={{ color: "var(--an-fg-mute)" }}>[{noteDate(p.time)}]</span>
                )}
              </div>
              {p.title && (
                <p className="an-term-mono mb-1 text-[13px] font-bold uppercase leading-snug" style={{ color: "var(--an-fg)", letterSpacing: "0.06em" }}>{p.title}</p>
              )}
              {p.snippet && (
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{p.snippet}</p>
              )}
              {mediaUrl(p.image) && (
                <img src={mediaUrl(p.image)} alt="" referrerPolicy="no-referrer" className="mt-2 max-h-44 w-full object-cover" style={{ border: "1px solid var(--an-line)" }} />
              )}
            </button>
          ))}
        </div>
      )}
      {openId !== null && (
        openPost ? (
          <BlogPostView post={openPost} wallet={openPost.author} onClose={() => setOpenId(null)} />
        ) : (
          // Full body still in flight (or gone from the author's table): keep the
          // tap responsive with a lightweight state instead of a dead button.
          <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "var(--an-bg)" }} onClick={() => setOpenId(null)}>
            <p className="an-term-mono text-xs" style={{ color: "var(--an-fg-mute)" }}>
              {openPost === null ? "Post not found on-chain." : "Loading post…"}
            </p>
          </div>
        )
      )}
    </div>
  );
}
