// XML property lists into the typed tree: dict, array, string, integer, real, true, false, date and
// data (base64, shown as its size and first bytes). The XML is read by xml.js, so positions, errors
// and the partial tree after an error work as they do for any XML file.

import { childrenOf } from "../tree.js";
import { parseXml } from "./xml.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

/**
 * @param {string} text
 * @param {import("./xml.js").XmlOptions} [options]
 * @returns {DataDoc}
 */
export function parsePlist(text, options = {}) {
  const xml = parseXml(text, { ...options, trim: false });
  const errors = [...xml.errors];
  const top = xml.roots[0];
  if (!top) return { roots: [], errors, warnings: [] };
  const value = top.key === "plist" ? elements(top)[0] : top;
  if (!value) {
    if (errors.length === 0)
      errors.push({ message: "The property list is empty.", line: top.line, col: top.col });
    return { roots: [], errors, warnings: [] };
  }
  /** @type {import("../tree.js").ParseError[]} */
  const problems = [];
  const root = convert(value, problems);
  return {
    roots: [root],
    errors: [...errors, ...problems.slice(0, errors.length ? 0 : 1)],
    warnings: [],
  };
}

/** @param {DataNode} node */
const elements = (node) => childrenOf(node).filter((child) => child.kind === "element");

/** The text inside an element and where it is. */
const textOf = (/** @type {DataNode} */ node) => {
  const texts = childrenOf(node).filter((child) => child.tag === "text" || child.tag === "cdata");
  const value = texts.map((t) => String(t.value ?? "")).join("");
  const first = texts[0];
  const last = texts.at(-1);
  return { value, from: first?.from ?? node.from, to: last?.to ?? node.from };
};

/**
 * @param {DataNode} element
 * @param {import("../tree.js").ParseError[]} problems
 * @returns {DataNode}
 */
function convert(element, problems) {
  const place = { line: element.line, col: element.col };
  const name = String(element.key);
  if (name === "dict") {
    /** @type {DataNode[]} */
    const children = [];
    const items = elements(element);
    for (let i = 0; i < items.length; i += 2) {
      const key = /** @type {DataNode} */ (items[i]);
      const value = items[i + 1];
      if (key.key !== "key" || !value) {
        problems.push({
          message: "A dict needs a <key> before each value.",
          line: key.line,
          col: key.col,
        });
        break;
      }
      const child = convert(value, problems);
      Object.assign(child, { key: textOf(key).value, line: key.line, col: key.col });
      children.push(child);
    }
    return { kind: "object", children, ...place, from: element.from, to: element.to };
  }
  if (name === "array") {
    const children = elements(element).map((item, index) =>
      Object.assign(convert(item, problems), { key: index }),
    );
    return { kind: "array", children, ...place, from: element.from, to: element.to };
  }
  if (name === "true" || name === "false")
    return {
      kind: "boolean",
      value: name === "true",
      ...place,
      from: element.from,
      to: element.to,
    };
  const { value, from, to } = textOf(element);
  if (name === "integer" || name === "real")
    return { kind: "number", value: value.trim(), ...place, from, to };
  if (name === "date") return { kind: "date", value: value.trim(), ...place, from, to };
  if (name === "data") return { kind: "binary", value: fromBase64(value), ...place, from, to };
  if (name !== "string")
    problems.push({ message: `<${name}> is not a property list value.`, ...place });
  return { kind: "string", value, ...place, from, to };
}

/** @param {string} text */
function fromBase64(text) {
  try {
    const binary = atob(text.replace(/\s+/g, ""));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}
