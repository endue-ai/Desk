// A small XML reader for the tables of contents and property lists archives carry (xar's TOC, a
// DMG's plist, a WIM's image list). Elements, attributes and text; no DTDs, no namespaces.

/** @typedef {{ name: string, attrs: Record<string, string>, children: XmlNode[], text: string }} XmlNode */

const ENTITIES = /** @type {Record<string, string>} */ ({
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
});
/** @param {string} s */
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
    if (name[0] === "#")
      return String.fromCodePoint(
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1)),
      );
    return ENTITIES[name] ?? whole;
  });

/** Parse `source` into its root element; throws a sentence when it is not well formed. @param {string} source */
export function parseXml(source) {
  /** @type {XmlNode} */
  const top = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [top];
  const tag =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const current = /** @type {XmlNode} */ (stack.at(-1));
    if (m[1] !== undefined) current.text += m[1];
    else if (m[2] !== undefined) {
      if (current.name !== m[2] || stack.length < 2) throw new Error("The XML is not well formed.");
      stack.pop();
    } else if (m[3] !== undefined) {
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        attrs[a[1] ?? ""] = decodeEntities(a[2] ?? a[3] ?? "");
      /** @type {XmlNode} */
      const node = { name: m[3], attrs, children: [], text: "" };
      current.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) current.text += decodeEntities(m[6]);
  }
  const root = top.children[0];
  if (!root || stack.length !== 1) throw new Error("The XML is not well formed.");
  return root;
}

/** The first child named `name`. @param {XmlNode | undefined} node @param {string} name */
export const child = (node, name) => node?.children.find((c) => c.name === name);
/** Every child named `name`. @param {XmlNode | undefined} node @param {string} name */
export const children = (node, name) => node?.children.filter((c) => c.name === name) ?? [];
/** The trimmed text of the first child named `name`. @param {XmlNode | undefined} node @param {string} name */
export const textOf = (node, name) => child(node, name)?.text.trim() ?? "";

/**
 * A property list's value as JSON-like data: dict, array, string, integer, real, true, false, date
 * and data (base64 text, kept as a string).
 * @param {XmlNode | undefined} node
 * @returns {unknown}
 */
export function plistValue(node) {
  if (!node) return undefined;
  switch (node.name) {
    case "plist":
      return plistValue(node.children[0]);
    case "dict": {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (let i = 0; i + 1 < node.children.length; i += 2)
        out[node.children[i]?.text ?? ""] = plistValue(node.children[i + 1]);
      return out;
    }
    case "array":
      return node.children.map(plistValue);
    case "integer":
    case "real":
      return Number(node.text.trim());
    case "true":
      return true;
    case "false":
      return false;
    case "data":
      return node.text.replace(/\s+/g, "");
    default:
      return node.text;
  }
}
