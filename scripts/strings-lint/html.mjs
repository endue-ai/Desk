import { JSDOM } from "jsdom";

export const LABEL_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "label",
  "placeholder",
  "title",
];

/** The visible text nodes and accessible copy in a static HTML document, with source positions. */
export function htmlCopy(source) {
  const dom = new JSDOM(source, { includeNodeLocations: true });
  const { document, Node } = dom.window;
  const found = [];
  function walk(node) {
    const at = dom.nodeLocation(node);
    if (node.nodeType === Node.TEXT_NODE && at && /\p{L}/u.test(node.data)) {
      found.push({ node, at, line: at.startLine, text: node.data.trim() });
    }
    if (node.nodeType === Node.ELEMENT_NODE && at) {
      for (const attr of LABEL_ATTRIBUTES) {
        const text = node.getAttribute(attr);
        const loc = at.attrs?.[attr];
        if (loc && text && /\p{L}/u.test(text))
          found.push({ node, at: loc, attr, line: loc.startLine, text });
      }
    }
    if (node.localName === "script" || node.localName === "style") return;
    for (const child of (node.localName === "template" ? node.content : node).childNodes)
      walk(child);
  }
  walk(document);
  return { dom, findings: found };
}
