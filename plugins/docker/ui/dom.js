// The helpers the renderers share: make an element with attributes and children, make a row, a
// state dot that says its state in words, a heading that folds, and an empty state.

/**
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./tree.js").RowSpec} RowSpec
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
 * A row: its class names, what it is and how deep it sits; `extra` keys it, makes it markable or
 * makes it the heading of a group of markable rows.
 * @param {Document} doc
 * @param {string} classes
 * @param {Item | undefined} item
 * @param {number} level
 * @param {(Node | string | undefined)[]} children
 * @param {string} [fold]
 * @param {{ key?: string, markable?: boolean, group?: string[] }} [extra]
 * @returns {RowSpec}
 */
export function row(doc, classes, item, level, children, fold, extra = {}) {
  const node = el(doc, "div", { class: `row ${classes}` }, ...children);
  return { el: node, item, level, ...(fold ? { fold } : {}), ...extra };
}

/** A span with a class and text. */
export const span = (
  /** @type {Document} */ doc,
  /** @type {string} */ classes,
  /** @type {string} */ text,
) => el(doc, "span", { class: classes }, text);

/** The fold mark of a heading. */
export const caret = (/** @type {Document} */ doc, /** @type {boolean} */ open) =>
  el(doc, "span", { class: "caret", "aria-hidden": "true" }, open ? "▾" : "▸");

/** A section heading row that folds the rows under it; `group` makes Space mark them all. */
export function heading(
  /** @type {Document} */ doc,
  /** @type {string} */ key,
  /** @type {string} */ title,
  /** @type {Set<string>} */ folded,
  /** @type {string} */ count = "",
  /** @type {string[] | undefined} */ group = undefined,
) {
  return row(
    doc,
    "section",
    { kind: "section", section: key },
    1,
    [
      caret(doc, !folded.has(key)),
      span(doc, "title", title),
      count ? span(doc, "count desk-badge", count) : undefined,
    ],
    key,
    group ? { group } : {},
  );
}

/** A state as a coloured dot with the state in words for screen readers. */
export function stateDot(
  /** @type {Document} */ doc,
  /** @type {string} */ state,
  /** @type {string | null} */ health = null,
  /** @type {string} */ label = "",
) {
  const words = label || (health && state === "running" ? `${state}, ${health}` : state);
  return el(doc, "span", {
    class: `dot state-${state}${health ? ` health-${health}` : ""}`,
    role: "img",
    "aria-label": words,
    title: words,
  });
}

/** An empty state: what belongs here and the next useful action. */
export const empty = (/** @type {Document} */ doc, /** @type {string} */ text) =>
  row(doc, "empty", undefined, 1, [el(doc, "span", { class: "desk-muted" }, text)]);
