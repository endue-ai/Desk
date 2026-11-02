// Writing one scalar back into a file. A string's editor holds its value, written here in the old
// token's style (its quotes, its escapes); other scalars take a literal in the format's syntax,
// checked by the plugin's own parser. Each writer returns the token and what the file must read
// as afterwards; a refusal is an Error named EditRefused whose message is the sentence to show.

import { parseJson } from "../parse/json.js";
import { parseToml } from "../parse/toml.js";
import { parseYaml } from "../parse/yaml.js";
import { resolve } from "../parse/yaml-scalars.js";
import { childrenOf, isBranch } from "../tree.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {{ kind: string, value: unknown }} Expected What the edited node reads as afterwards
 * @typedef {{ token: string, expected: Expected }} Written
 */

/** @param {string} message */
export function refused(message) {
  const error = new Error(message);
  error.name = "EditRefused";
  return error;
}

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const SHORT = /** @type {Record<string, string>} */ ({
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
});
const shown = (/** @type {string} */ text) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);
const hex4 = (/** @type {number} */ n, upper = false) => {
  const digits = n.toString(16).padStart(4, "0");
  return `\\u${upper ? digits.toUpperCase() : digits}`;
};

/**
 * A JSON string token for `value` in the style of `raw`, the token it replaces: `\uXXXX` for
 * non-ASCII when `raw` wrote non-ASCII so (in its hex case), `\/` when `raw` escaped a slash.
 * @param {string} value
 * @param {string} [raw]
 */
export function jsonStringToken(value, raw = "") {
  const escapes = [...raw.matchAll(/\\u([0-9a-fA-F]{4})/g)].map((m) => m[1] ?? "");
  const wide = escapes.filter((h) => Number.parseInt(h, 16) >= 0x80);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII is the point
  const ascii = wide.length > 0 && /^[\x00-\x7f]*$/.test(raw);
  const upper = escapes.some((h) => /[A-F]/.test(h));
  const slash = raw.includes("\\/");
  let out = '"';
  for (const ch of value) {
    const code = /** @type {number} */ (ch.codePointAt(0));
    if (SHORT[ch]) out += SHORT[ch];
    else if (ch === "/" && slash) out += "\\/";
    else if (code < 0x20) out += hex4(code, upper);
    else if (code >= 0x80 && ascii) {
      if (code < 0x10000) out += hex4(code, upper);
      else
        out +=
          hex4(0xd800 + ((code - 0x10000) >> 10), upper) +
          hex4(0xdc00 + ((code - 0x10000) & 0x3ff), upper);
    } else out += ch;
  }
  return `${out}"`;
}

/**
 * A JSON literal for a number, true, false or null node: what the person typed, trimmed.
 * @param {string} text
 * @returns {Written}
 */
export function jsonLiteral(text) {
  const token = text.trim();
  if (NUMBER.test(token)) return { token, expected: { kind: "number", value: token } };
  if (token === "true" || token === "false")
    return { token, expected: { kind: "boolean", value: token === "true" } };
  if (token === "null") return { token, expected: { kind: "null", value: null } };
  if (token.startsWith('"')) {
    const doc = parseJson(token);
    const root = doc.roots[0];
    if (doc.errors.length === 0 && root?.kind === "string")
      return { token, expected: { kind: "string", value: root.value } };
  }
  throw refused(
    `${shown(token)} is not a JSON value: write a number, true, false, null or a string in double quotes.`,
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters need escapes
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters need escapes
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff]/g;

/** A YAML double-quoted string: JSON's escapes, and \u for every non-printable character. */
const yamlDouble = (/** @type {string} */ value) =>
  `"${value.replace(/["\\]/g, (c) => `\\${c}`).replace(CONTROLS, (c) => SHORT[c] ?? hex4(c.charCodeAt(0)))}"`;

/** Whether `value` reads back as the same string written plain, in block or flow context. */
function plainSafe(/** @type {string} */ value) {
  if (value === "" || value !== value.trim() || CONTROL.test(value)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || /[,[\]{}]|: |:$| #/.test(value)) return false;
  /** @type {DataNode} */
  const probe = { kind: "string", value, line: 1, col: 1 };
  resolve(probe, value, "plain", undefined);
  return probe.kind === "string";
}

/**
 * The YAML token for an edited node: a string in its old style where the value allows it (plain,
 * single or double quotes; a block scalar becomes double-quoted), else one YAML value as typed.
 * @param {DataNode} node
 * @param {string} raw The old token, without the tag or anchor before it
 * @param {string} text
 * @returns {Written}
 */
export function yamlToken(node, raw, text) {
  if (node.kind === "string") {
    const expected = { kind: "string", value: text };
    const first = raw[0] ?? "";
    if (first === "'" && !CONTROL.test(text))
      return { token: `'${text.replaceAll("'", "''")}'`, expected };
    if (first !== '"' && first !== "'" && first !== "|" && first !== ">" && plainSafe(text))
      return { token: text, expected };
    return { token: yamlDouble(text), expected };
  }
  const token = text.trim();
  const doc = parseYaml(token);
  const root = doc.roots[0];
  if (
    token === "" ||
    /[\r\n]/.test(token) ||
    doc.errors.length > 0 ||
    doc.roots.length !== 1 ||
    !root ||
    isBranch(root) ||
    root.alias ||
    root.anchor
  )
    throw refused(
      `${shown(token)} is not one YAML value: write a number, true, false, null or a string.`,
    );
  return { token, expected: { kind: root.kind, value: root.value } };
}

/** A TOML basic string: its escapes, and \u for every other control character. */
const tomlBasic = (/** @type {string} */ value) =>
  `"${value.replace(/["\\]/g, (c) => `\\${c}`).replace(CONTROLS, (c) => SHORT[c] ?? hex4(c.charCodeAt(0)))}"`;

/**
 * The TOML token for an edited node: a string as a literal string where it was one and the value
 * allows it, else a basic string; other scalars as typed, read by the TOML parser.
 * @param {DataNode} node
 * @param {string} raw
 * @param {string} text
 * @returns {Written}
 */
export function tomlToken(node, raw, text) {
  if (node.kind === "string") {
    const expected = { kind: "string", value: text };
    const literal = raw.startsWith("'") && !raw.startsWith("'''");
    if (literal && !text.includes("'") && !CONTROL.test(text))
      return { token: `'${text}'`, expected };
    return { token: tomlBasic(text), expected };
  }
  const token = text.trim();
  const doc = parseToml(`value = ${token}\n`);
  const [value, ...more] = doc.roots[0] ? childrenOf(doc.roots[0]) : [];
  if (/[\r\n]/.test(token) || doc.errors.length > 0 || !value || more.length > 0 || isBranch(value))
    throw refused(
      `${shown(token)} is not a TOML value: write a number, true, false or a string in quotes.`,
    );
  if (value.kind === "date") throw refused("Dates and times are not edited here yet.");
  return { token, expected: { kind: value.kind, value: value.value } };
}
