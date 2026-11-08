// XML through the platform's DOMParser, read by local names so a reader does not care which
// prefix or namespace version a producer used (ODF 1.x and OpenOffice 1.0, OWPML 2011 and 2016).
import { DocError } from "./model.js";

/**
 * @param {string} text
 * @param {string} what the part's name, for the reason a damaged file gives
 * @returns {Document}
 */
export function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement)
    throw new DocError(`This file is damaged: ${what} is not well-formed XML.`);
  return doc;
}

/** The element children of `el`, all or those with one local name. */
export function kids(
  /** @type {Element | null | undefined} */ el,
  /** @type {string} */ local = "",
) {
  /** @type {Element[]} */
  const out = [];
  if (!el) return out;
  for (let child = el.firstElementChild; child; child = child.nextElementSibling)
    if (!local || child.localName === local) out.push(child);
  return out;
}

/** The first element child with a local name. */
export function kid(/** @type {Element | null | undefined} */ el, /** @type {string} */ local) {
  if (!el) return null;
  for (let child = el.firstElementChild; child; child = child.nextElementSibling)
    if (child.localName === local) return child;
  return null;
}

/** A path of local names down the first children: kidPath(rPr, "rFonts"). */
export function kidPath(
  /** @type {Element | null | undefined} */ el,
  /** @type {string[]} */ ...locals
) {
  let at = el ?? null;
  for (const local of locals) at = kid(at, local);
  return at;
}

/** The descendants with a local name, in document order. */
export const findAll = (
  /** @type {Element | Document | null | undefined} */ el,
  /** @type {string} */ local,
) => (el ? Array.from(el.getElementsByTagNameNS("*", local)) : []);

/** The first descendant with a local name. */
export const find = (
  /** @type {Element | Document | null | undefined} */ el,
  /** @type {string} */ local,
) => (el ? (el.getElementsByTagNameNS("*", local)[0] ?? null) : null);

/**
 * An attribute by local name, whatever its prefix; null when absent.
 * @param {Element | null | undefined} el
 * @param {string} local
 */
export function attr(el, local) {
  if (!el) return null;
  const plain = el.getAttribute(local);
  if (plain !== null) return plain;
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
  return null;
}

/** A numeric attribute, or undefined. */
export function num(/** @type {Element | null | undefined} */ el, /** @type {string} */ local) {
  const value = attr(el, local);
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * An on/off property as OOXML writes it: present means on unless val says 0, false, off or none.
 * @param {Element | null | undefined} el
 * @returns {boolean | undefined}
 */
export function onOff(el) {
  if (!el) return undefined;
  const value = attr(el, "val");
  return value === null || !["0", "false", "off", "none"].includes(value);
}
