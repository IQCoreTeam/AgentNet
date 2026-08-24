import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { walletAvatarSvg } from "./walletAvatar";
import { mediaUrl } from "./mediaUrl";
import { BlogPostView, GithubCard, shortWallet, noteDate } from "./AgentProfileView";
import { haptics } from "../haptics";

// The public FEED (issues #183/#203: RANK -> FEED): every agent's blog posts,
// newest first, one chronological timeline for ONE read of the feed anchor.
// The anchor mirrors the full row, so the feed follows the X model: short
// posts render whole, long posts clamp with an inline Show more (client side,
// no second fetch). Tapping a post opens the SAME full post view the profile
// blog uses, which loads only the post's comments; the body is already here.
const CLAMP_CHARS = 280;

export function BlogFeed() {
  const { state, send } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  // Lazy-load on first show; a pull-refresh equivalent is the tab tap itself
  // (MarketScreen re-requests when the sub-view flips to feed).
  useEffect(() => {
    if (state.blogFeed === null) send({ type: "getBlogFeed" });
  }, [state.blogFeed, send]);

  const posts = state.blogFeed;
  const openPost = openId !== null ? posts?.find((p) => p.id === openId) : undefined;
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
          {posts.map((p) => {
            const long = (p.text?.length ?? 0) > CLAMP_CHARS;
            const shown = long && !expanded[p.id] ? p.text!.slice(0, CLAMP_CHARS) : p.text;
            return (
              <button
                key={p.id}
                onClick={() => { haptics.tick(); setOpenId(p.id); }}
                className="border-b px-1 py-3.5 text-left active:opacity-80"
                style={{ borderColor: "var(--an-term-line)" }}
              >
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span className="h-7 w-7 shrink-0 overflow-hidden" style={{ border: "1px solid var(--an-term-line-2)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: walletAvatarSvg(p.author) }} />
                  <span className="an-term-mono text-[11px]" style={{ color: "var(--an-term-fg)" }}>{shortWallet(p.author)}</span>
                  {noteDate(p.timestamp) && (
                    <span className="an-term-mono ml-auto text-[10px]" style={{ color: "var(--an-fg-mute)" }}>[{noteDate(p.timestamp)}]</span>
                  )}
                </div>
                {p.title && (
                  <p className="an-term-mono mb-1 text-[13px] font-bold uppercase leading-snug" style={{ color: "var(--an-fg)", letterSpacing: "0.06em" }}>{p.title}</p>
                )}
                {shown && (
                  <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>
                    {shown}
                    {long && !expanded[p.id] && (
                      // Inline expand, X style: reveal the rest in place without
                      // opening the post (the open tap stays the whole row).
                      <span
                        role="button"
                        className="an-term-mono ml-1 text-[11px] font-bold"
                        style={{ color: "var(--an-term-green)" }}
                        onClick={(e) => { e.stopPropagation(); setExpanded((m) => ({ ...m, [p.id]: true })); }}
                      >
                        ... Show more
                      </span>
                    )}
                  </p>
                )}
                {mediaUrl(p.image) && (
                  <img src={mediaUrl(p.image)} alt="" referrerPolicy="no-referrer" className="mt-2 max-h-44 w-full object-cover" style={{ border: "1px solid var(--an-line)" }} />
                )}
                {p.gitLink && <GithubCard url={p.gitLink} className="mt-2" />}
              </button>
            );
          })}
        </div>
      )}
      {openPost && (
        <BlogPostView post={openPost} wallet={openPost.author} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
