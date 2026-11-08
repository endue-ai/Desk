// INI, CFG and CONF files (sections, keys, `;` and `#` comments, quoted values) and Java properties
// files (every separator, escapes, continuation lines and \uXXXX) into the typed tree. Values are
// strings, as both formats have no types; a key without a value is null.

import { errorAt, lineStarts, positionOf } from "../lines.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

const BARE_KEY = /^[^\s=:;#[\]]+$/;

/**
 * @param {string} text
 * @returns {DataDoc}
 */
export function parseIni(text) {
  const lines = lineStarts(text);
  /** @type {DataNode} */
  const root = { kind: "object", children: [], line: 1, col: 1, from: 0, to: text.length };
  let section = root;
  /** @type {DataNode | undefined} */
  let last;
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i] ?? 0;
    let end = i + 1 < lines.length ? (lines[i + 1] ?? 0) - 1 : text.length;
    if (text[end - 1] === "\r") end--;
    const line = text.slice(start, end);
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    const at = start + indent;
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      const close = trimmed.lastIndexOf("]");
      const rest = trimmed.slice(close + 1).trim();
      if (close < 0 || (rest !== "" && !/^[;#]/.test(rest))) {
        errors.push(errorAt(lines, at, "A section header needs its closing ]."));
        break;
      }
      const name = trimmed.slice(1, close).trim();
      const children = /** @type {DataNode[]} */ (root.children);
      const found = children.find((child) => child.key === name && child.kind === "object");
      section = found ?? {
        kind: "object",
        key: name,
        children: [],
        ...positionOf(lines, at),
        from: at,
        to: end,
      };
      if (!found) children.push(section);
      last = undefined;
      continue;
    }
    const separator = line.slice(indent).search(/[=:]/);
    if (separator < 0) {
      if (indent > 0 && last && typeof last.value === "string") {
        last.value += `\n${trimmed}`;
        last.to = end;
        continue;
      }
      if (!BARE_KEY.test(trimmed)) {
        errors.push(errorAt(lines, at, "This line is not a section, a key or a comment."));
        break;
      }
      last = {
        kind: "null",
        key: trimmed,
        value: null,
        ...positionOf(lines, at),
        from: at,
        to: end,
      };
      section.children?.push(last);
      continue;
    }
    const key = line.slice(indent, indent + separator).trim();
    let valueAt = indent + separator + 1;
    while (line[valueAt] === " " || line[valueAt] === "\t") valueAt++;
    let raw = line.slice(valueAt);
    const comment = /\s[;#]/.exec(raw);
    const quoted = /^(["']).*\1\s*(?:[;#].*)?$/.exec(raw);
    if (quoted) raw = raw.slice(0, raw.lastIndexOf(quoted[1] ?? "") + 1);
    else if (comment) raw = raw.slice(0, comment.index);
    raw = raw.trimEnd();
    const value = /^(["']).*\1$/.test(raw) && raw.length >= 2 ? raw.slice(1, -1) : raw;
    if (key === "") {
      errors.push(errorAt(lines, at, "A key needs a name before its = or :."));
      break;
    }
    last = {
      kind: "string",
      key,
      value,
      ...positionOf(lines, at),
      from: start + valueAt,
      to: start + valueAt + raw.length,
    };
    section.children?.push(last);
  }
  return { roots: [root], errors, warnings: [] };
}

/** @type {Record<string, string>} */
const ESCAPES = { t: "\t", n: "\n", r: "\r", f: "\f" };

/**
 * Java properties: `key=value`, `key: value` or `key value`, with escapes and continuations.
 * @param {string} text
 * @returns {DataDoc}
 */
export function parseProperties(text) {
  const lines = lineStarts(text);
  /** @type {DataNode} */
  const root = { kind: "object", children: [], line: 1, col: 1, from: 0, to: text.length };
  const len = text.length;
  let pos = 0;
  const blank = (/** @type {number} */ at) =>
    text[at] === " " || text[at] === "\t" || text[at] === "\f";
  const eol = (/** @type {number} */ at) => at >= len || text[at] === "\n" || text[at] === "\r";
  /** Read up to a stop character, with escapes; a backslash at the line's end continues it. */
  const read = (/** @type {(at: number) => boolean} */ stop) => {
    let out = "";
    while (!eol(pos) && !stop(pos)) {
      const c = text[pos] ?? "";
      if (c !== "\\") {
        out += c;
        pos++;
        continue;
      }
      const e = text[pos + 1] ?? "";
      if (eol(pos + 1)) {
        pos++;
        if (text[pos] === "\r") pos++;
        if (text[pos] === "\n") pos++;
        while (blank(pos)) pos++;
        continue;
      }
      if (e === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) {
        out += String.fromCharCode(Number.parseInt(text.slice(pos + 2, pos + 6), 16));
        pos += 6;
        continue;
      }
      out += ESCAPES[e] ?? e;
      pos += 2;
    }
    return out;
  };
  while (pos < len) {
    while (blank(pos)) pos++;
    if (eol(pos) || text[pos] === "#" || text[pos] === "!") {
      while (!eol(pos)) pos++;
      pos++;
      continue;
    }
    const at = pos;
    const key = read((p) => text[p] === "=" || text[p] === ":" || blank(p));
    while (blank(pos)) pos++;
    if (text[pos] === "=" || text[pos] === ":") pos++;
    while (blank(pos)) pos++;
    const from = pos;
    const value = read(() => false);
    root.children?.push({ kind: "string", key, value, ...positionOf(lines, at), from, to: pos });
    pos++;
  }
  return { roots: [root], errors: [], warnings: [] };
}
