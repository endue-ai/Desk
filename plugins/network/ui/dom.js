// Small DOM helpers: elements and SVG built from data, text always as text (a device's mDNS name
// or an SSID never becomes markup), and the terms with their one-line help (NET-18).

const SVG = "http://www.w3.org/2000/svg";

/**
 * @typedef {Record<string, string | number | boolean | null | undefined>} Attrs
 * @typedef {Node | string | number | null | undefined | false} Child
 */

/** @param {Element} el @param {Attrs} attrs */
function apply(el, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
}

/** @param {Document} doc @param {Element} el @param {Child[]} children */
function append(doc, el, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "object" ? child : doc.createTextNode(String(child)));
  }
}

/**
 * An HTML element.
 * @param {Document} doc @param {string} tag @param {Attrs} [attrs] @param {...(Child | Child[])} children
 */
export function h(doc, tag, attrs = {}, ...children) {
  const el = doc.createElement(tag);
  apply(el, attrs);
  append(doc, el, /** @type {Child[]} */ (children));
  return el;
}

/**
 * An SVG element.
 * @param {Document} doc @param {string} tag @param {Attrs} [attrs] @param {...(Child | Child[])} children
 */
export function s(doc, tag, attrs = {}, ...children) {
  const el = doc.createElementNS(SVG, tag);
  apply(el, attrs);
  append(doc, el, /** @type {Child[]} */ (children));
  return el;
}

/** Replace an element's children. @param {Element} el @param {...(Child | Child[])} children */
export function fill(el, ...children) {
  el.replaceChildren();
  append(/** @type {Document} */ (el.ownerDocument), el, /** @type {Child[]} */ (children));
  return el;
}

/** The terms that carry a line of help, by their message id after `term.` and `help.`. */
export const TERMS = Object.freeze([
  "ipAddress",
  "macAddress",
  "manufacturer",
  "port",
  "wifiChannel",
  "ping",
  "securityMode",
  "mdns",
  "randomMac",
  "router",
  "congestion",
  "signal",
  "kind",
]);

/**
 * A term with its help: the name, and the line as the tooltip and the accessible description.
 * @param {Document} doc @param {(id: string) => string} t @param {string} term
 */
export function term(doc, t, term) {
  return h(doc, "dfn", { class: "term", title: t(`help.${term}`), tabindex: 0 }, t(`term.${term}`));
}

/** Every term and its line, for the glossary. @param {Document} doc @param {(id: string) => string} t */
export function glossary(doc, t) {
  return h(
    doc,
    "details",
    { class: "desk-details glossary" },
    h(doc, "summary", {}, t("glossary.title")),
    h(
      doc,
      "dl",
      {},
      TERMS.flatMap((name) => [
        h(doc, "dt", {}, t(`term.${name}`)),
        h(doc, "dd", {}, t(`help.${name}`)),
      ]),
    ),
  );
}

/** A time for people: the desk's locale, hours and minutes today, the date otherwise. @param {string} iso @param {string} language */
export function timeText(iso, language, now = Date.now()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date(now).toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(
    language,
    today ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
}
