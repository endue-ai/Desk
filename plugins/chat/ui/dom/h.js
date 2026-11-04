// Making DOM nodes without HTML: every text goes in as textContent and every attribute by name, so
// nothing a message says is ever parsed as markup. And keyed lists: the children of a container
// kept by key and redrawn only when what they show changed, so focus, scroll and a half-typed
// reply survive a redraw.

/**
 * @typedef {Record<string, string | number | boolean | undefined | null>} Attrs
 * @typedef {Node | string | null | undefined | false} Child
 */

/**
 * An element with attributes (`class`, `text`, and any attribute by name; `true` sets it empty,
 * `false`, null and undefined leave it out) and children.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {Document} doc
 * @param {K} tag
 * @param {Attrs} [attrs]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(doc, tag, attrs = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") el.className = String(value);
    else if (name === "text") el.textContent = String(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return el;
}

/**
 * Keep a container's children in the order of `items`, by key: an item whose signature did not
 * change keeps its node; a new or changed one is made again; the rest leave.
 * @template T
 * @param {HTMLElement} container
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @param {(item: T) => string} signatureOf
 * @param {(item: T) => HTMLElement} make
 * @param {Map<string, { node: HTMLElement, signature: string }>} held kept between calls
 */
export function keyed(container, items, keyOf, signatureOf, make, held) {
  const seen = new Set();
  /** @type {HTMLElement[]} */
  const nodes = [];
  for (const item of items) {
    const key = keyOf(item);
    seen.add(key);
    const signature = signatureOf(item);
    const was = held.get(key);
    if (was && was.signature === signature) nodes.push(was.node);
    else {
      const node = make(item);
      held.set(key, { node, signature });
      nodes.push(node);
    }
  }
  for (const key of [...held.keys()]) if (!seen.has(key)) held.delete(key);
  // Move only what is out of place, so a focused node that stays is never taken out.
  let at = container.firstElementChild;
  for (const node of nodes) {
    if (at === node) {
      at = at.nextElementSibling;
      continue;
    }
    container.insertBefore(node, at);
  }
  while (at) {
    const next = at.nextElementSibling;
    at.remove();
    at = next;
  }
}

/** Whether a scrolled box is at its end, within a few pixels. */
export const atEnd = (/** @type {HTMLElement} */ box) =>
  box.scrollHeight - box.scrollTop - box.clientHeight < 48;
