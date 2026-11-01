// The scalars of YAML 1.2 that span lines: single and double quoted (with every escape) and literal
// and folded block scalars (chomping and indentation indicators), how a scalar resolves (its tag,
// or the core schema's null, bool, int and float, and timestamps as dates), and a key's text.

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("./yaml-scan.js").Reader} Reader
 */

import { YamlFail } from "./yaml-scan.js";

/** @type {Record<string, string>} */
const ESCAPES = {
  0: "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xa0",
  L: " ",
  P: " ",
};
const HEX_LENGTH = /** @type {Record<string, number>} */ ({ x: 2, u: 4, U: 8 });

/**
 * A single or double quoted scalar at the cursor, folded over its lines.
 * @param {Reader} r
 */
export function quoted(r) {
  const start = r.pos;
  const quote = r.ch();
  let at = start + 1;
  let out = "";
  /** How many characters at the end of `out` are blanks from the text, which a fold trims. */
  let blanks = 0;
  for (;;) {
    const c = r.ch(at);
    if (c === "") throw new YamlFail(start, "A quoted scalar is not closed.");
    if (c === quote) {
      if (quote === "'" && r.ch(at + 1) === "'") {
        out += "'";
        blanks = 0;
        at += 2;
        continue;
      }
      at++;
      break;
    }
    if (c === "\\" && quote === '"') {
      const e = r.ch(at + 1);
      if (e === "\n" || e === "\r") {
        at = r.skipBreak(at + 1);
        while (r.ch(at) === " " || r.ch(at) === "\t") at++;
        blanks = 0;
        continue;
      }
      const size = HEX_LENGTH[e];
      if (size) {
        const hex = r.text.slice(at + 2, at + 2 + size);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== size)
          throw new YamlFail(at, `The escape \\${e} needs ${size} hex digits.`);
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        at += 2 + size;
      } else if (e in ESCAPES) {
        out += ESCAPES[e];
        at += 2;
      } else throw new YamlFail(at, `Unknown escape \\${e}.`);
      blanks = 0;
      continue;
    }
    if (c === "\n" || c === "\r") {
      out = out.slice(0, out.length - blanks);
      at = r.skipBreak(at);
      let empty = 0;
      for (;;) {
        while (r.ch(at) === " " || r.ch(at) === "\t") at++;
        const next = r.ch(at);
        if (next !== "\n" && next !== "\r") break;
        empty++;
        at = r.skipBreak(at);
      }
      if (r.isMarker(r.lineStartOf(at)) && r.col(at) === 0)
        throw new YamlFail(at, "A document marker inside a quoted scalar.");
      out += empty > 0 ? "\n".repeat(empty) : " ";
      blanks = 0;
      continue;
    }
    out += c;
    blanks = c === " " || c === "\t" ? blanks + 1 : 0;
    at++;
  }
  r.pos = at;
  return out;
}

/**
 * A literal (`|`) or folded (`>`) block scalar at the cursor, inside a node indented `n`. The
 * cursor ends at the start of the first line after it.
 * @param {number} n
 */
export function block(r, n) {
  const start = r.pos;
  const folded = r.ch() === ">";
  r.pos++;
  let chomp = "clip";
  let indicator = 0;
  for (let i = 0; i < 2; i++) {
    const c = r.ch();
    if (c === "+" || c === "-") {
      chomp = c === "+" ? "keep" : "strip";
      r.pos++;
    } else if (/[1-9]/.test(c)) {
      indicator = Number(c);
      r.pos++;
    }
  }
  r.inlineSpace();
  r.comment();
  if (!r.eolAt()) throw new YamlFail(r.pos, "Unexpected text after a block scalar's header.");
  let lineStart = r.nextLine();
  let indent = indicator ? Math.max(n, 0) + indicator : -1;
  let out = "";
  let empty = 0;
  let read = false;
  let moreIndented = false;
  for (; lineStart < r.len; lineStart = r.nextLine(lineStart)) {
    const line = r.peekRaw(lineStart);
    if (line.marker) break;
    if (line.blank) {
      empty++;
      continue;
    }
    if (indent < 0) {
      if (line.indent <= n) break;
      indent = line.indent;
    }
    if (line.indent < indent) break;
    let end = r.text.indexOf("\n", lineStart);
    if (end < 0) end = r.len;
    if (r.ch(end - 1) === "\r") end--;
    const text = r.text.slice(lineStart + indent, end);
    if (!folded) out += "\n".repeat(read ? 1 + empty : empty);
    else if (text.startsWith(" ") || text.startsWith("\t")) {
      moreIndented = true;
      out += "\n".repeat(read ? 1 + empty : empty);
    } else if (moreIndented) {
      moreIndented = false;
      out += "\n".repeat(empty + 1);
    } else if (empty === 0) {
      if (read) out += " ";
    } else out += "\n".repeat(empty);
    out += text;
    read = true;
    empty = 0;
  }
  if (chomp === "keep") out += "\n".repeat(read ? 1 + empty : empty);
  else if (chomp === "clip" && read) out += "\n";
  r.pos = Math.min(lineStart, r.len);
  return { value: out, from: start };
}

const NULL = /^(?:null|Null|NULL|~|)$/;
const BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
const INT = /^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/;
const FLOAT =
  /^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const TIMESTAMP =
  /^\d{4}-\d\d?-\d\d?(?:(?:[Tt]|[ \t]+)\d\d?:\d\d:\d\d(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?)?$/;
const DATE = /^\d{4}-\d\d-\d\d$/;

/**
 * Give a scalar its kind: by its tag, or for a plain scalar by the core schema (and timestamps).
 * @param {DataNode} node
 * @param {string} text
 * @param {"plain" | "quoted" | "block"} style
 * @param {string | undefined} tag
 */
export function resolve(node, text, style, tag) {
  const plain = style === "plain" && !tag;
  if (tag === "!!binary") {
    node.kind = "binary";
    node.value = decodeBase64(text);
  } else if (tag === "!!null" || (plain && NULL.test(text))) {
    node.kind = "null";
    node.value = null;
  } else if (tag === "!!bool" || (plain && BOOL.test(text))) {
    node.kind = "boolean";
    node.value = /^true$/i.test(text);
  } else if (
    tag === "!!int" ||
    tag === "!!float" ||
    (plain && (INT.test(text) || FLOAT.test(text)))
  ) {
    node.kind = "number";
  } else if (
    tag === "!!timestamp" ||
    (plain && TIMESTAMP.test(text) && (text.length > 10 || DATE.test(text)))
  ) {
    node.kind = "date";
  }
}

/**
 * The text a key shows as: scalars as written, collections in flow style.
 * @param {DataNode} node
 * @param {string} source
 * @returns {string}
 */
export const keyText = (node, source) => {
  if (node.kind === "null" || node.kind === "boolean")
    return source.slice(node.from ?? 0, node.to ?? 0).trim();
  if (node.kind === "array")
    return `[${(node.children ?? []).map((c) => keyText(c, source)).join(", ")}]`;
  if (node.kind === "object") {
    const pairs = (node.children ?? []).map((c) => `${String(c.key)}: ${keyText(c, source)}`);
    return `{${pairs.join(", ")}}`;
  }
  if (node.kind === "binary") return "!!binary";
  return String(node.value ?? "");
};

/** @param {string} text */
function decodeBase64(text) {
  const clean = text.replace(/\s+/g, "");
  try {
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}
