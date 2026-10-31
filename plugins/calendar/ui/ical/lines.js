// iCalendar content lines (RFC 5545 §3.1): unfolding and folding, a line's name, parameters and value,
// TEXT escaping (§3.3.11) and parameter value encoding (RFC 6868). Values stay as written: a property
// is decoded only when something reads it, so whatever another app wrote goes back out unchanged.

/**
 * One property: its name in upper case, its parameters (names in upper case, values as decoded
 * strings, in the order written) and its value exactly as written. A parsed property keeps the text
 * before its value in `head`, so it is written back as it was (quotes and case included); a property
 * made anew has none. A line that does not parse keeps its text in `raw`.
 * @typedef {{ name: string, params: Record<string, string[]>, value: string, head?: string,
 *   raw?: string }} Prop
 */

/**
 * Split a document into logical lines: CRLF, a bare LF or a bare CR ends a line, and a line that
 * starts with a space or a tab continues the one before (the space or tab is dropped).
 * @param {string} text
 * @returns {Array<{ text: string, line: number }>} each line with the number of its first physical line
 */
export function unfold(text) {
  const physical = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  /** @type {Array<{ text: string, line: number }>} */
  const lines = [];
  physical.forEach((line, i) => {
    const last = lines.at(-1);
    if ((line.startsWith(" ") || line.startsWith("\t")) && last) last.text += line.slice(1);
    else if (line !== "") lines.push({ text: line, line: i + 1 });
  });
  return lines;
}

const encoder = new TextEncoder();

/**
 * Fold one logical line into physical lines of at most 75 octets, never inside a UTF-8 sequence, each
 * continuation starting with one space (§3.1). Lines end with CRLF.
 * @param {string} line
 */
export function fold(line) {
  if (encoder.encode(line).length <= 75) return `${line}\r\n`;
  let out = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (size + octets > limit) {
      out += "\r\n ";
      size = 0;
      limit = 74;
    }
    out += char;
    size += octets;
  }
  return `${out}\r\n`;
}

/** RFC 6868: ^n is a new line, ^' a double quote and ^^ a caret in a parameter value. */
const decodeParam = (/** @type {string} */ value) =>
  value.replace(/\^([n'^])/g, (_, c) => (c === "n" ? "\n" : c === "'" ? '"' : "^"));

const encodeParam = (/** @type {string} */ value) =>
  value.replace(/\^/g, "^^").replace(/\n/g, "^n").replace(/"/g, "^'");

/**
 * Parse one logical line into a property; undefined when it has no name or no colon.
 * @param {string} text
 * @returns {Prop | undefined}
 */
export function parseLine(text) {
  const name = /^[A-Za-z0-9-]+/.exec(text)?.[0];
  if (!name) return undefined;
  /** @type {Record<string, string[]>} */
  const params = {};
  let i = name.length;
  while (text[i] === ";") {
    const key = /^[A-Za-z0-9-]+/.exec(text.slice(i + 1))?.[0];
    if (!key || text[i + 1 + key.length] !== "=") return undefined;
    i += key.length + 2;
    /** @type {string[]} */
    const values = [];
    for (;;) {
      if (text[i] === '"') {
        const close = text.indexOf('"', i + 1);
        if (close < 0) return undefined;
        values.push(decodeParam(text.slice(i + 1, close)));
        i = close + 1;
      } else {
        const end = /[,;:]|$/.exec(text.slice(i));
        const length = end ? end.index : text.length - i;
        values.push(decodeParam(text.slice(i, i + length)));
        i += length;
      }
      if (text[i] !== ",") break;
      i++;
    }
    const upper = key.toUpperCase();
    params[upper] = [...(params[upper] ?? []), ...values];
  }
  if (text[i] !== ":") return undefined;
  return { name: name.toUpperCase(), params, value: text.slice(i + 1), head: text.slice(0, i) };
}

/** A parameter value is quoted when it holds a character that would end it (§3.2). */
const paramValue = (/** @type {string} */ value) => {
  const encoded = encodeParam(value);
  return /[;:,]/.test(encoded) ? `"${encoded}"` : encoded;
};

/**
 * Write one property as a folded line with CRLF.
 * @param {Prop} prop
 */
export function formatLine(prop) {
  if (prop.raw !== undefined) return fold(prop.raw);
  if (prop.head !== undefined) return fold(`${prop.head}:${prop.value}`);
  let line = prop.name;
  for (const [key, values] of Object.entries(prop.params))
    line += `;${key}=${values.map(paramValue).join(",")}`;
  return fold(`${line}:${prop.value}`);
}

/**
 * Decode a TEXT value (§3.3.11): \n or \N is a new line, \\ \; \, are the characters themselves.
 * @param {string} value
 */
export function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

/**
 * Encode a TEXT value.
 * @param {string} text
 */
export function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Split a list value on the commas that are not escaped (CATEGORIES, RESOURCES, EXDATE).
 * @param {string} value
 */
export function splitList(value) {
  /** @type {string[]} */
  const parts = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      current += c + value[i + 1];
      i++;
    } else if (c === ",") {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  return parts;
}
