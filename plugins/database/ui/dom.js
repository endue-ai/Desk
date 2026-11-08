// The one helper the renderers share: make an element with attributes and children.

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, string | boolean | undefined>} [attrs] `class` sets the class list.
 * @param {...(Node | string | undefined)} children
 */
export function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === "class") node.className = String(value);
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === undefined) continue;
    node.append(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return node;
}
