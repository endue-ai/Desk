// XML through the platform's DOMParser, read by local names so prefixes and the strict and
// transitional OOXML namespaces read alike. A document that does not parse throws.

/** @param {string} text @returns {Element} */
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName === "parsererror" || doc.getElementsByTagName("parsererror").length)
    throw new Error("damaged XML");
  return root;
}

/** The element children of `el`, optionally only those with one of the local names. */
export function kids(
  /** @type {Element | null | undefined} */ el,
  /** @type {string[]} */ ...names
) {
  if (!el) return [];
  const out = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling)
    if (names.length === 0 || names.includes(c.localName)) out.push(c);
  return out;
}

/** The first child with one of the local names. */
export function kid(
  /** @type {Element | null | undefined} */ el,
  /** @type {string[]} */ ...names
) {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling)
    if (names.includes(c.localName)) return c;
  return null;
}

/** Follow a path of local names from `el`: path(el, "spPr", "xfrm", "off"). */
export function path(
  /** @type {Element | null | undefined} */ el,
  /** @type {string[]} */ ...names
) {
  let at = el ?? null;
  for (const name of names) at = kid(at, name);
  return at;
}

/** Every descendant with the local name, in document order. */
export function all(/** @type {Element | null | undefined} */ el, /** @type {string} */ name) {
  return el ? [...el.getElementsByTagNameNS("*", name)] : [];
}

/** The first descendant with the local name. */
export const find = (/** @type {Element | null | undefined} */ el, /** @type {string} */ name) =>
  all(el, name)[0] ?? null;

/** An attribute by local name, whatever its prefix; null when absent. */
export function attr(/** @type {Element | null | undefined} */ el, /** @type {string} */ name) {
  if (!el) return null;
  const plain = el.getAttribute(name);
  if (plain !== null) return plain;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

/** A relationship attribute (r:id, r:embed, r:link), in either OOXML namespace. */
export function relAttr(/** @type {Element | null | undefined} */ el, /** @type {string} */ name) {
  if (!el) return null;
  for (const a of el.attributes)
    if (a.localName === name && (a.namespaceURI ?? "").includes("relationships")) return a.value;
  return null;
}

/** A number attribute, or `fallback` when it is absent or not a number. */
export function num(
  /** @type {Element | null | undefined} */ el,
  /** @type {string} */ name,
  /** @type {number} */ fallback = 0,
) {
  const value = attr(el, name);
  if (value === null || value === "") return fallback;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  // Strict OOXML writes percentages as "50%"; transitional as 50000.
  return value.endsWith("%") ? n * 1000 : n;
}

/** A boolean attribute (1, true, on), or `fallback`. */
export function bool(
  /** @type {Element | null | undefined} */ el,
  /** @type {string} */ name,
  /** @type {boolean} */ fallback = false,
) {
  const value = attr(el, name);
  if (value === null) return fallback;
  return value === "1" || value === "true" || value === "on";
}

/** The element's text, children included. */
export const textOf = (/** @type {Element | null | undefined} */ el) => el?.textContent ?? "";
