import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "./renderMarkdown";

// Assistant bubbles only. Renders markdown to sanitized HTML (DOMPurify) and injects it —
// safe because the HTML is sanitized at the source. Memoized so streaming re-renders
// don't re-parse unchanged text. Copy buttons are appended to each <pre> block via
// useEffect so they survive streaming re-renders without re-parsing HTML.
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cleanups: (() => void)[] = [];
    ref.current.querySelectorAll<HTMLElement>("pre, table").forEach((el) => {
      el.setAttribute("data-no-swipe", "");
    });
    ref.current.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
      if (pre.querySelector(".copy-btn")) return;
      const btn = document.createElement("button");
      btn.textContent = "Copy";
      btn.className = "copy-btn";
      const onClick = async () => {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
      };
      btn.addEventListener("click", onClick);
      pre.appendChild(btn);
      cleanups.push(() => btn.removeEventListener("click", onClick));
    });
    // Loopback links (http://127.0.0.1:PORT / localhost) open the in-app PREVIEW tab
    // instead of navigating the whole webview away — the agent just prints its dev-server
    // URL and it becomes a one-tap preview. Non-loopback links are left untouched.
    ref.current.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      // Absolute links only — a relative markdown link like [x](src/app.js) resolves
      // against this page's own loopback origin and must NOT become a preview link.
      if (!/^https?:\/\//i.test(a.getAttribute("href") ?? "")) return;
      let u: URL;
      try { u = new URL(a.href); } catch { return; }
      // ::1 is deliberately not handled — the server only ever announces 127.0.0.1.
      if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return;
      // Never frame the app inside its own preview tab.
      if (u.host === window.location.host) return;
      a.classList.add("preview-link");
      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("agentnet:openPreview", { detail: { url: a.href } }));
      };
      a.addEventListener("click", onClick);
      cleanups.push(() => a.removeEventListener("click", onClick));
    });
    return () => cleanups.forEach((fn) => fn());
  }, [html]);

  return (
    <div
      ref={ref}
      className="md prose-sm max-w-none break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
