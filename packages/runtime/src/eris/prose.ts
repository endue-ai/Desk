/**
 * Her answer as a person reads it (issue 161, finding 6): paragraphs, its lines, list items as
 * bullets, headings as plain lines, `**bold**` and `` `code` `` as such. Built from text nodes only,
 * so what a brain writes is never markup.
 */

const INLINE = /(\*\*|__)(.+?)\1|`([^`]+)`/g;

function inline(doc: Document, line: string): Node[] {
  const out: Node[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > at) out.push(doc.createTextNode(line.slice(at, index)));
    const el = doc.createElement(m[3] === undefined ? "strong" : "code");
    el.textContent = m[3] ?? m[2] ?? "";
    out.push(el);
    at = index + m[0].length;
  }
  if (at < line.length) out.push(doc.createTextNode(line.slice(at)));
  return out;
}

/** One paragraph for each block of `text` that a blank line ends. */
export function prose(doc: Document, text: string): HTMLParagraphElement[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const p = doc.createElement("p");
      block.split("\n").forEach((line, i) => {
        if (i > 0) p.append(doc.createElement("br"));
        const bare = line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^(\s*)[-*+]\s+/, "$1• ");
        p.append(...inline(doc, bare));
      });
      return p;
    });
}
