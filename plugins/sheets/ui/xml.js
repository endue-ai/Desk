// Attribute-only XML tree for OOXML styles and themes. No DOM, external entities or DTDs.
/** @typedef {{ localName: string, children: XmlNode[], getAttribute(name: string): string | null }} XmlNode */
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text) =>
  text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, key) => {
    if (key[0] !== "#") return entities[key] ?? _;
    const value = key[1] === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
  });
/** @param {string} xml @returns {XmlNode | undefined} */
export function parseXml(xml) {
  /** @type {XmlNode[]} */
  const stack = [];
  let root;
  const tags =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[\w:.-]+(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gu;
  for (const [tag] of xml.matchAll(tags)) {
    if (tag.startsWith("<!") || tag.startsWith("<?")) continue;
    const name = /^<\/?([\w:.-]+)/u.exec(tag)?.[1]?.split(":").at(-1) ?? "";
    if (tag.startsWith("</")) {
      if (stack.pop()?.localName !== name) return undefined;
      continue;
    }
    const attrs = new Map();
    for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu))
      attrs.set(match[1], decode(match[2] ?? match[3] ?? ""));
    const node = { localName: name, children: [], getAttribute: (key) => attrs.get(key) ?? null };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else if (root) return undefined;
    else root = node;
    if (!tag.endsWith("/>")) stack.push(node);
  }
  return stack.length ? undefined : root;
}
/** @param {XmlNode | undefined} node @param {string} name @returns {XmlNode | undefined} */
export function descendant(node, name) {
  if (node?.localName === name) return node;
  for (const child of node?.children ?? []) {
    const found = descendant(child, name);
    if (found) return found;
  }
}
