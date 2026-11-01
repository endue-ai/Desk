// The non-image chunks a reader needs: hidden text (TXTa, TXTz), the outline (NAVM), the colours of
// JB2 shapes (FGbz) and the title among the annotations (ANTa, ANTz). DjVu v3 specification,
// sections 8.3.3 to 8.3.5 and 8.3.10.

import { bzz } from "./bzz.js";
import { u16, u24 } from "./iff.js";

const utf8 = new TextDecoder("utf-8", { fatal: false });
/** Vertical tab, form feed, carriage return and the group, record and unit separators. */
const SEPARATORS = new Set([0x0b, 0x0c, 0x0d, 0x1d, 0x1e, 0x1f]);

/**
 * A page's text in reading order from a TXTa (`compressed` false) or TXTz chunk. The zone
 * separators the text may carry (column, region, paragraph and line ends) become line breaks.
 * @param {Uint8Array} data @param {boolean} compressed
 */
export function pageText(data, compressed) {
  const bytes = compressed ? bzz(data) : data;
  if (bytes.length < 3) return "";
  const length = u24(bytes, 0);
  if (3 + length > bytes.length) throw new Error("The page's text chunk is cut short.");
  let text = "";
  for (const c of utf8.decode(bytes.subarray(3, 3 + length)).replace(/\0+$/, "")) {
    text += SEPARATORS.has(c.charCodeAt(0)) ? "\n" : c;
  }
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @typedef {{ title: string, url: string, page: number | null, children: Outline[] }} Outline
 * `page` is the 0-based page an internal link ("#3", "#p0003.djvu") points to, else null.
 */

/**
 * The outline from a NAVM chunk. `pageOf` turns a link's target into a page index or null.
 * @param {Uint8Array} data @param {(target: string) => number | null} pageOf
 * @returns {Outline[]}
 */
export function outline(data, pageOf) {
  const bytes = bzz(data);
  if (bytes.length < 2) return [];
  let left = u16(bytes, 0);
  let at = 2;
  const take = () => {
    if (at + 3 > bytes.length) throw new Error("The document's outline is cut short.");
    const length = u24(bytes, at);
    at += 3;
    if (at + length > bytes.length) throw new Error("The document's outline is cut short.");
    const text = utf8.decode(bytes.subarray(at, at + length));
    at += length;
    return text;
  };
  /** @returns {Outline} */
  const entry = (/** @type {number} */ depth) => {
    if (left-- <= 0 || depth > 64) throw new Error("The document's outline is damaged.");
    if (at >= bytes.length) throw new Error("The document's outline is cut short.");
    const count = bytes[at++];
    const title = take().replace(/\0+$/, "");
    const url = take().replace(/\0+$/, "");
    const children = [];
    for (let i = 0; i < count; i++) children.push(entry(depth + 1));
    const target = url.startsWith("#") ? pageOf(url.slice(1)) : null;
    return { title, url, page: target, children };
  };
  const out = [];
  while (left > 0 && at < bytes.length) out.push(entry(0));
  return out;
}

/**
 * The colours of a page's JB2 shapes from its FGbz chunk: a palette and, when the chunk has
 * them, one palette index per blit in the order the blits were placed.
 * @param {Uint8Array} data
 * @returns {{ colours: Uint8Array, indices: Uint16Array | null }} colours as RGB triples
 */
export function palette(data) {
  if (data.length < 3) throw new Error("The page's colour palette (FGbz) is cut short.");
  const version = data[0];
  const count = u16(data, 1);
  if (3 + count * 3 > data.length)
    throw new Error("The page's colour palette (FGbz) is cut short.");
  const colours = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const at = 3 + i * 3; // stored blue, green, red
    colours[i * 3] = data[at + 2];
    colours[i * 3 + 1] = data[at + 1];
    colours[i * 3 + 2] = data[at];
  }
  if (!(version & 0x80)) return { colours, indices: null };
  let at = 3 + count * 3;
  if (at + 3 > data.length) throw new Error("The page's colour palette (FGbz) is cut short.");
  const blits = u24(data, at);
  at += 3;
  const packed = bzz(data.subarray(at), blits * 2);
  if (packed.length < blits * 2) throw new Error("The page's colour palette (FGbz) is cut short.");
  const indices = new Uint16Array(blits);
  for (let i = 0; i < blits; i++) {
    const index = u16(packed, i * 2);
    if (index >= count) throw new Error("The page's colour palette (FGbz) is damaged.");
    indices[i] = index;
  }
  return { colours, indices };
}

/**
 * The document's title from annotation text: `(metadata ... (title "..."))`.
 * @param {string} text
 * @returns {string | undefined}
 */
export function annotationTitle(text) {
  for (const form of expressions(text)) {
    if (!Array.isArray(form) || form[0] !== "metadata") continue;
    for (const entry of form.slice(1)) {
      if (Array.isArray(entry) && entry[0] === "title" && typeof entry[1] === "string") {
        const title = entry[1].trim();
        if (title) return title;
      }
    }
  }
  return undefined;
}

/**
 * The top-level expressions of annotation text: lists of symbols, strings and lists. Strings
 * are kept with a marker so they differ from symbols; damaged text yields what parses.
 * @param {string} text
 * @returns {any[]}
 */
function expressions(text) {
  let at = 0;
  const STRING = Symbol("string");
  /** @returns {any} */
  const read = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
    if (at >= text.length) return STRING;
    const c = text[at];
    if (c === "(") {
      at++;
      const list = [];
      for (;;) {
        while (at < text.length && /\s/.test(text[at])) at++;
        if (at >= text.length) return list;
        if (text[at] === ")") {
          at++;
          return list;
        }
        const item = read();
        if (item === STRING) return list;
        list.push(item);
      }
    }
    if (c === '"') {
      at++;
      let out = "";
      while (at < text.length && text[at] !== '"') {
        if (text[at] === "\\" && at + 1 < text.length) {
          at++;
          out += { n: "\n", t: "\t", r: "\r" }[text[at]] ?? text[at];
        } else out += text[at];
        at++;
      }
      at++;
      return out;
    }
    if (c === ")") {
      at++;
      return read();
    }
    const start = at;
    while (at < text.length && !/[\s()"]/.test(text[at])) at++;
    return { symbol: text.slice(start, at) };
  };
  const out = [];
  for (let guard = 0; at < text.length && guard < 10000; guard++) {
    const form = read();
    if (form === STRING) break;
    out.push(symbols(form));
  }
  return out;
}

/** Symbols as their names, strings as strings. @param {any} form @returns {any} */
const symbols = (form) =>
  Array.isArray(form) ? form.map(symbols) : typeof form === "string" ? form : form.symbol;
