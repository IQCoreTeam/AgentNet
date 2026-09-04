// The quote card's data rule (issue #215): which line of a quoted post is its title and what
// is left for the snippet. Split from fillQuoteCard so the rule can be pinned without a DOM;
// the card builder in quotes.ts is its only caller. The first line is trimmed only when it is
// promoted; a present title is used as-is, whitespace or not (the CLI trims first, see the
// follow-ups in the #215 plan), so this stays a panel rule rather than a shared one.
export function quoteCardModel(post) {
  const lines = String(post.text || '').split('\n');
  const firstLine = (lines[0] || '').trim();
  const title = post.title || firstLine;
  const snippet = (post.title ? String(post.text || '') : lines.slice(1).join('\n')).trim();
  return { title, snippet };
}
