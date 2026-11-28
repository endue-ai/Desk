// Building DOM from data, text always as text: session titles and paths come from transcripts.

/**
 * An element with attributes, listeners (`on<event>`) and children (strings become text).
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {Array<Node | string | false | null | undefined>} children
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function")
      node.addEventListener(name.slice(2), value);
    else if (name === "dataset") Object.assign(node.dataset, value);
    else if (name === "style" && typeof value === "object") Object.assign(node.style, value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children)
    if (child !== false && child !== null && child !== undefined) node.append(child);
  return node;
}

/** A dot in a theme colour token. */
export const dot = (/** @type {string} */ token) =>
  el("span", { class: "dot", style: { background: `var(${token})` } });

/** Replace the children of `node`. */
export function fill(
  /** @type {Element} */ node,
  /** @type {Array<Node | string | false | null | undefined>} */ children,
) {
  node.replaceChildren(...children.filter((c) => c !== false && c !== null && c !== undefined));
}
