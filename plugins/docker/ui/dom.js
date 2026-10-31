// Two helpers the renderers share: make an element with attributes and children, and make a row.

/**
 * @typedef {import("./actions.js").Item} Item
 * @typedef {{ el: HTMLElement, item: Item | undefined, level: number, fold?: string }} RowSpec
 */

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

/**
 * A row of the tree: its class names, what it is and how deep it sits.
 * @param {Document} doc
 * @param {string} classes
 * @param {Item | undefined} item
 * @param {number} level
 * @param {(Node | string | undefined)[]} children
 * @param {string} [fold]
 * @returns {RowSpec}
 */
export function row(doc, classes, item, level, children, fold) {
  const node = el(doc, "div", { class: `row ${classes}` }, ...children);
  return { el: node, item, level, ...(fold ? { fold } : {}) };
}

/** A span with a class and text. */
export const span = (
  /** @type {Document} */ doc,
  /** @type {string} */ classes,
  /** @type {string} */ text,
) => el(doc, "span", { class: classes }, text);
