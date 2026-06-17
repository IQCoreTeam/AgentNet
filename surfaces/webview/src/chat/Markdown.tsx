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
