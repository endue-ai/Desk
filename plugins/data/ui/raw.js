// The raw view's lines: a text file's lines, or for binary formats a hex dump with offsets, and the
// token colours of a line by format. Lines are cut out on demand, so a file of any size costs one
// index of line starts. Tokens are coloured line by line: a comment or string that spans lines is
// coloured where it starts.

import { lineStarts } from "./lines.js";
import { ROW } from "./parse/binary.js";

/**
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {{ kind: "text" | "hex", count: number, text(line: number): string,
 *   start(line: number): number, end(line: number): number }} RawLines
 * @typedef {[string, string]} Token A class (or "") and its text
 */

/**
 * @param {Opened} opened
 * @returns {RawLines}
 */
export function rawLines(opened) {
  if (opened.bytes && opened.text === undefined) return hexLines(opened.bytes);
  const text = opened.text ?? "";
  const starts = lineStarts(text);
  const count = text.endsWith("\n") && starts.length > 1 ? starts.length - 1 : starts.length;
  const start = (/** @type {number} */ line) => starts[line - 1] ?? text.length;
  const end = (/** @type {number} */ line) => {
    let stop = line < starts.length ? (starts[line] ?? 0) - 1 : text.length;
    if (text.charCodeAt(stop - 1) === 0x0d) stop--;
    return stop;
  };
  return { kind: "text", count, start, end, text: (line) => text.slice(start(line), end(line)) };
}

/** @param {Uint8Array} bytes @returns {RawLines} */
function hexLines(bytes) {
  const count = Math.max(1, Math.ceil(bytes.length / ROW));
  const start = (/** @type {number} */ line) => (line - 1) * ROW;
  const end = (/** @type {number} */ line) => Math.min(bytes.length, line * ROW);
  return {
    kind: "hex",
    count,
    start,
    end,
    text: (line) => hexRow(bytes, start(line), end(line)),
  };
}

/** One hex dump row: offset, the bytes in hex, and the printable ones. */
export function hexRow(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ from,
  /** @type {number} */ to,
  masked = (/** @type {number} */ _at) => false,
) {
  const hex = [];
  let ascii = "";
  for (let at = from; at < to; at++) {
    const b = bytes[at] ?? 0;
    if (masked(at)) {
      hex.push("••");
      ascii += "•";
      continue;
    }
    hex.push(b.toString(16).padStart(2, "0"));
    ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  }
  return `${from.toString(16).padStart(8, "0")}  ${hex.join(" ").padEnd(ROW * 3 - 1)}  |${ascii}|`;
}

/** @type {Record<string, Array<[RegExp, string]>>} */
const RULES = {
  json: [
    [/\/\/.*|\/\*.*?(?:\*\/|$)/y, "tok-comment"],
    [/"(?:[^"\\]|\\.)*"?(?=\s*:)|'(?:[^'\\]|\\.)*'?(?=\s*:)|[A-Za-z_$][\w$]*(?=\s*:)/y, "tok-key"],
    [/"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/y, "tok-string"],
    [/[-+]?(?:0x[0-9a-fA-F]+|Infinity|NaN|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y, "tok-number"],
    [/\b(?:true|false|null)\b/y, "tok-literal"],
    [/[{}[\],:]/y, "tok-punct"],
  ],
  yaml: [
    [/#.*/y, "tok-comment"],
    [/(?:---|\.\.\.)(?=\s|$)/y, "tok-punct"],
    [/[&*][^\s,[\]{}]+|!\S*/y, "tok-tag"],
    [
      /(?<=^[\s-]*)(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:,[\]{}-][^#:]*?)(?=\s*:(?:\s|$))/y,
      "tok-key",
    ],
    [/"(?:[^"\\]|\\.)*"?|'(?:[^']|'')*'?/y, "tok-string"],
    [
      /(?<=(?:^[\s-]*|:\s+|[[,{]\s*))\d{4}-\d\d-\d\d(?:[Tt ][\d:.]+(?:Z|[ ]?[-+][\d:]+)?)?(?=\s*(?:$|#|,|\]|\}))/y,
      "tok-date",
    ],
    [
      /(?<=(?:^[\s-]*|:\s+|[[,{]\s*))[-+]?(?:0x[0-9a-fA-F]+|0o[0-7]+|\.(?:inf|Inf|INF|nan|NaN|NAN)|\d+\.?\d*(?:[eE][-+]?\d+)?)(?=\s*(?:$|#|,|\]|\}))/y,
      "tok-number",
    ],
    [
      /(?<=(?:^[\s-]*|:\s+|[[,{]\s*))(?:true|false|True|False|TRUE|FALSE|null|Null|NULL|~)(?=\s*(?:$|#|,|\]|\}))/y,
      "tok-literal",
    ],
    [/-(?=\s)|:(?=\s|$)|[?|>,[\]{}]/y, "tok-punct"],
  ],
  toml: [
    [/#.*/y, "tok-comment"],
    [/\[\[?[^\]]*\]\]?(?=\s*(?:#|$))/y, "tok-section"],
    [/(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)(?=\s*(?:\.[^=]*)?=)/y, "tok-key"],
    [/"""|'''|"(?:[^"\\]|\\.)*"?|'[^']*'?/y, "tok-string"],
    [
      /\d{4}-\d\d-\d\d(?:[Tt ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[-+]\d\d:\d\d)?)?|\d\d:\d\d:\d\d(?:\.\d+)?/y,
      "tok-date",
    ],
    [
      /[-+]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*\.?[\d_]*(?:[eE][-+]?\d+)?)/y,
      "tok-number",
    ],
    [/\b(?:true|false)\b/y, "tok-literal"],
    [/[=,[\]{}]/y, "tok-punct"],
  ],
  xml: [
    [/<!--.*?(?:-->|$)/y, "tok-comment"],
    [/<!\[CDATA\[.*?(?:\]\]>|$)/y, "tok-string"],
    [/<\/?[^\s/>]+|\/?>|<\?\S*|\?>/y, "tok-tag"],
    [/[^\s=<>/"']+(?==)/y, "tok-attr"],
    [/"[^"]*"?|'[^']*'?/y, "tok-string"],
    [/&[^;\s]+;/y, "tok-literal"],
  ],
  ini: [
    [/^\s*[;#!].*/y, "tok-comment"],
    [/^\s*\[[^\]]*\]?/y, "tok-section"],
    [/^\s*(?:export\s+)?[^=:\s][^=:]*?(?=\s*[=:])/y, "tok-key"],
    [/[=:]/y, "tok-punct"],
    [/"(?:[^"\\]|\\.)*"?|'[^']*'?/y, "tok-string"],
  ],
  hcl: [
    [/#.*|\/\/.*|\/\*.*?(?:\*\/|$)/y, "tok-comment"],
    [/"(?:[^"\\]|\\.)*"?/y, "tok-string"],
    [/<<-?[A-Za-z_]\w*/y, "tok-string"],
    [/[A-Za-z_][\w-]*(?=\s*=(?!=))/y, "tok-key"],
    [/^\s*[A-Za-z_][\w-]*(?=\s+(?:"|[A-Za-z_][\w-]*\s*)*\{)/y, "tok-section"],
    [/\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/y, "tok-number"],
    [/\b(?:true|false|null)\b/y, "tok-literal"],
    [/[=,[\]{}()]/y, "tok-punct"],
  ],
  hex: [
    [/^[0-9a-f]{8}/y, "tok-offset"],
    [/\|.*\|$/y, "tok-string"],
  ],
};

/** @type {Record<string, string>} */
const FAMILY = {
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  plist: "xml",
  ini: "ini",
  properties: "ini",
  env: "ini",
  hcl: "hcl",
  msgpack: "hex",
  cbor: "hex",
  bson: "hex",
  bplist: "hex",
};

/**
 * The tokens of one line of a file in `format`: [class, text] pairs that join to the line.
 * @param {string} format
 * @param {string} line
 * @returns {Token[]}
 */
export function tokenize(format, line) {
  const rules = RULES[FAMILY[format] ?? ""];
  if (!rules) return [["", line]];
  /** @type {Token[]} */
  const out = [];
  let plain = "";
  let at = 0;
  while (at < line.length) {
    let matched = false;
    for (const [pattern, name] of rules) {
      pattern.lastIndex = at;
      const m = pattern.exec(line);
      if (!m || m[0] === "") continue;
      if (plain) out.push(["", plain]);
      plain = "";
      out.push([name, m[0]]);
      at += m[0].length;
      matched = true;
      break;
    }
    if (!matched) plain += line[at++];
  }
  if (plain) out.push(["", plain]);
  return out;
}
