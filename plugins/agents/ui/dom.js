// The helpers every view shares: an element with attributes and children (text is set as text,
// never as HTML), a kit button, an agent's avatar and badges, and markdown through @endue-ai/ui's
// <desk-markdown>, which falls back to plain text where the element is not defined.

/** @typedef {import("./cards.js").Card} Card */

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, string | number | boolean | undefined | ((event: any) => void)>} [attrs]
 *   `class` sets the class list, `on<event>` listens, `text` sets the text
 * @param {...(Node | string | undefined | null | false)} children
 * @returns {HTMLElement}
 */
export function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") node.addEventListener(name.slice(2), value);
    else if (name === "class") node.className = String(value);
    else if (name === "text") node.textContent = String(value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    node.append(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return node;
}

/**
 * Replace `parent`'s children with the ones given, leaving out the absent ones (replaceChildren
 * would write `null` as text).
 * @param {HTMLElement} parent
 * @param {...(Node | string | undefined | null | false)} children
 */
export function fill(parent, ...children) {
  parent.replaceChildren(
    ...children.filter(
      /** @returns {child is Node | string} */ (child) =>
        child !== undefined && child !== null && child !== false,
    ),
  );
}

/**
 * A kit button (the design system draws it) that runs `onclick`.
 * @param {Document} doc
 * @param {string} label
 * @param {() => void} onclick
 * @param {{ variant?: "primary" | "danger" | "quiet", attrs?: Record<string, string | boolean | undefined> }} [options]
 */
export function button(doc, label, onclick, options = {}) {
  const variant = options.variant ? ` desk-btn-${options.variant}` : "";
  return el(
    doc,
    "button",
    {
      type: "button",
      class: `desk-btn${variant}`,
      onclick: (/** @type {Event} */ event) => {
        event.stopPropagation();
        onclick();
      },
      ...options.attrs,
    },
    label,
  );
}

/** An agent's avatar: its picture, or its initial on its colour. */
export function avatar(/** @type {Document} */ doc, /** @type {Card} */ card, size = "md") {
  const box = el(doc, "span", {
    class: `avatar avatar-${size}`,
    "data-hue": card.hue,
    "aria-hidden": "true",
  });
  if (card.avatarUrl) box.append(el(doc, "img", { src: card.avatarUrl, alt: "" }));
  else box.textContent = card.initial;
  return box;
}

/** Where an agent lives, as a badge: endue or Local. */
export const sourceBadge = (/** @type {Document} */ doc, /** @type {Card} */ card) =>
  el(doc, "span", { class: "desk-badge source", "data-source": card.source, text: card.badge });

/** The presence as a dot and words: the colour is never the only sign. */
export const presence = (/** @type {Document} */ doc, /** @type {Card} */ card) =>
  el(
    doc,
    "span",
    { class: "presence", "data-presence": card.presence },
    el(doc, "span", { class: "dot", "aria-hidden": "true" }),
    card.status,
  );

/**
 * An answer as markdown: a <desk-markdown> whose links go to `onLink`, or a <p> of plain text where
 * the element is not defined (a test document).
 * @param {Document} doc
 * @param {string} source
 * @param {(href: string) => void} [onLink]
 */
export function markdown(doc, source, onLink) {
  if (!doc.defaultView?.customElements?.get("desk-markdown"))
    return el(doc, "p", { class: "plain", text: source });
  const node = /** @type {HTMLElement & { source: string }} */ (doc.createElement("desk-markdown"));
  node.source = source;
  if (onLink)
    node.addEventListener("desk-link", (event) =>
      onLink(/** @type {CustomEvent<{ href: string }>} */ (event).detail.href),
    );
  return node;
}

/** Arrow keys move the focus among `selector` inside `root`, as a grid or list's would. */
export function arrows(/** @type {HTMLElement} */ root, /** @type {string} */ selector) {
  root.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = /** @type {Record<string, number>} */ (keys)[event.key];
    if (!step) return;
    const all = /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);
    const at = all.indexOf(/** @type {HTMLElement} */ (root.ownerDocument.activeElement));
    if (at < 0) return;
    event.preventDefault();
    all[Math.min(all.length - 1, Math.max(0, at + step))]?.focus();
  });
}
