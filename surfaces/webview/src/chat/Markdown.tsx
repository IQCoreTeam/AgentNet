import { useMemo } from "react";
import { renderMarkdown } from "./renderMarkdown";

// Assistant bubbles only. Renders markdown to sanitized HTML (DOMPurify) and injects it —
// safe because the HTML is sanitized at the source. Memoized so streaming re-renders
// don't re-parse unchanged text.
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="md prose-sm max-w-none break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
