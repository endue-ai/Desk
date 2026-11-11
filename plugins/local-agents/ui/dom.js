// The helpers the renderers share: make an element with attributes and children, a button that
// runs an action, a status badge, and markdown through @endue-ai/ui's <desk-markdown> (no raw
// HTML), which falls back to plain text where the element is not defined.

/**
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, string | boolean | undefined>} [attrs] `class` sets the class list.
 * @param {...(Node | string | undefined | false)} children
 */
export function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === "class") node.className = String(value);
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === undefined || child === false) continue;
    node.append(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return node;
}

/**
 * Replace a node's children, leaving out the absent ones as `el` does: `replaceChildren` itself
 * would write an absent child as the text "undefined".
 * @param {Element} node
 * @param {...(Node | string | undefined | false)} children
 */
export function fill(node, ...children) {
  node.replaceChildren(
    ...children.filter(
      /** @returns {child is Node | string} */ (child) => child !== undefined && child !== false,
    ),
  );
}

/**
 * A button that runs an action with its arguments.
 * @param {Document} doc
 * @param {string} label
 * @param {Act} act
 * @param {string} action
 * @param {unknown[]} [args]
 * @param {Record<string, string | boolean | undefined>} [attrs]
 */
export function button(doc, label, act, action, args = [], attrs = {}) {
  const node = el(doc, "button", { type: "button", ...attrs }, label);
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    void act(action, ...args);
  });
  return node;
}

const BADGES = {
  ready: "Ready",
  checking: "Checking…",
  missing: "Not installed",
  broken: "Does not run",
  denied: "Not allowed",
  unsupported: "Cannot run here",
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  todo: "To do",
};

/** A badge whose class is the state, for the colour; its text says the state in words. */
export function badge(/** @type {Document} */ doc, /** @type {string} */ state) {
  return el(
    doc,
    "span",
    { class: `badge ${state}` },
    /** @type {Record<string, string>} */ (BADGES)[state] ?? state,
  );
}

/**
 * An answer as markdown: a <desk-markdown> whose links go to `onLink`, or a <pre> where the
 * element is not defined (a test document).
 * @param {Document} doc
 * @param {string} source
 * @param {(href: string) => void} [onLink]
 */
export function markdown(doc, source, onLink) {
  const defined = doc.defaultView?.customElements?.get("desk-markdown");
  if (!defined) return el(doc, "pre", { class: "plain" }, source);
  const node = /** @type {HTMLElement & { source: string }} */ (doc.createElement("desk-markdown"));
  node.source = source;
  if (onLink)
    node.addEventListener("desk-link", (event) =>
      onLink(/** @type {CustomEvent<{ href: string }>} */ (event).detail.href),
    );
  return node;
}

/** The tool lines under an answer: what the agent read, ran or changed. */
export function toolList(
  /** @type {Document} */ doc,
  /** @type {{ name: string, detail: string }[]} */ tools,
) {
  if (tools.length === 0) return undefined;
  return el(
    doc,
    "ul",
    { class: "tools", "aria-label": "What the agent used" },
    ...tools.map((t) =>
      el(
        doc,
        "li",
        {},
        el(doc, "span", { class: "tool-name" }, t.name),
        t.detail ? ` ${t.detail}` : "",
      ),
    ),
  );
}
