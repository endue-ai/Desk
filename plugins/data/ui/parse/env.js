// dotenv files into the typed tree: `KEY=value`, `export KEY=value`, comments, unquoted values with
// trailing comments, double quotes (escapes, several lines), single quotes and backticks (as
// written). `${VAR}` stays as written. Every value is a secret: the view shows it as dots.

import { errorAt, lineStarts, positionOf } from "../lines.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

const KEY = /[A-Za-z_][A-Za-z0-9_.-]*/y;
/** @type {Record<string, string>} */
const ESCAPES = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\", $: "$" };

/**
 * @param {string} text
 * @returns {DataDoc}
 */
export function parseEnv(text) {
  const lines = lineStarts(text);
  /** @type {DataNode} */
  const root = { kind: "object", children: [], line: 1, col: 1, from: 0, to: text.length };
  const errors = [];
  const len = text.length;
  let pos = 0;
  const inline = () => {
    while (text[pos] === " " || text[pos] === "\t") pos++;
  };
  const toEol = () => {
    while (pos < len && text[pos] !== "\n") pos++;
  };
  while (pos < len) {
    inline();
    if (text[pos] === "\n" || text[pos] === "\r" || text[pos] === "#" || pos >= len) {
      toEol();
      pos++;
      continue;
    }
    if (text.startsWith("export", pos) && /[ \t]/.test(text[pos + 6] ?? "")) {
      pos += 6;
      inline();
    }
    const at = pos;
    KEY.lastIndex = pos;
    const key = KEY.exec(text)?.[0];
    if (key) pos += key.length;
    inline();
    if (!key || text[pos] !== "=") {
      errors.push(
        errorAt(lines, at, key ? `Expected "=" after ${key}.` : "Expected a NAME=value line."),
      );
      break;
    }
    pos++;
    inline();
    const quote = text[pos];
    let value = "";
    let from = pos;
    let to = pos;
    if (quote === '"' || quote === "'" || quote === "`") {
      from = ++pos;
      while (pos < len && text[pos] !== quote) {
        if (quote === '"' && text[pos] === "\\" && pos + 1 < len) {
          const e = text[pos + 1] ?? "";
          value += ESCAPES[e] ?? `\\${e}`;
          pos += 2;
          continue;
        }
        value += text[pos];
        pos++;
      }
      if (pos >= len) {
        errors.push(errorAt(lines, from - 1, `The value of ${key} is not closed.`));
        break;
      }
      to = pos++;
      inline();
      if (text[pos] === "#") toEol();
    } else {
      const end = text.indexOf("\n", pos);
      const line = text.slice(pos, end < 0 ? len : end);
      const comment = /(^|\s)#/.exec(line);
      const raw = (comment ? line.slice(0, comment.index) : line).replace(/\r$/, "").trimEnd();
      value = raw;
      to = pos + raw.length;
      pos = end < 0 ? len : end;
    }
    if (text[pos] === "\r") pos++;
    if (pos < len && text[pos] !== "\n") {
      errors.push(errorAt(lines, pos, `Unexpected text after the value of ${key}.`));
      break;
    }
    pos++;
    root.children?.push({
      kind: "string",
      key,
      value,
      secret: true,
      ...positionOf(lines, at),
      from,
      to,
    });
  }
  return { roots: [root], errors, warnings: [] };
}
