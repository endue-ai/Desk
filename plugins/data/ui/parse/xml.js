// XML, XSD, XSL and XSLT into the typed tree with DOMParser: elements, attributes with their
// prefixes, text and CDATA (comments and processing instructions are left out). DOMParser checks
// the document and decodes its values; the positions come from xml-scan.js, matched in document
// order. After an error the tree is the reader's, up to the error.

import { errorAt, lineStarts, positionOf } from "../lines.js";
import { scanXml } from "./xml-scan.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {import("./xml-scan.js").ScannedElement} ScannedElement
 * @typedef {{ DOMParser?: typeof DOMParser, trim?: boolean }} XmlOptions
 */

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const LOCATION = [
  /line (\d+) at column (\d+)/i,
  /line number (\d+), column (\d+)/i,
  /^(\d+):(\d+):/m,
];

/**
 * @param {string} text
 * @param {XmlOptions} [options]
 * @returns {DataDoc}
 */
export function parseXml(text, options = {}) {
  const Parser = options.DOMParser ?? globalThis.DOMParser;
  const lines = lineStarts(text);
  const trim = options.trim !== false;
  const scanned = scanXml(text);
  const build = new Builder(lines, trim);
  if (!Parser) return fromScan(text, lines, build, scanned.problem);
  const dom = new Parser().parseFromString(text, "application/xml");
  const failure = parseError(dom, lines);
  if (failure || !dom.documentElement) {
    const problem = failure ?? { offset: 0, message: "The file is not XML." };
    return fromScan(text, lines, build, problem);
  }
  const root = build.fromDom(dom.documentElement, scanned.elements);
  return { roots: [root], errors: [], warnings: [] };
}

/**
 * The tree the reader built up to the error, and the error.
 * @param {string} text
 * @param {Uint32Array} lines
 * @param {Builder} build
 * @param {{ offset: number, message: string } | undefined} problem
 * @returns {DataDoc}
 */
function fromScan(text, lines, build, problem) {
  const until = problem ? problem.offset : text.length;
  const { roots } = scanXml(text, until);
  const errors = problem ? [errorAt(lines, problem.offset, problem.message)] : [];
  return { roots: roots.slice(0, 1).map((root) => build.fromScan(root)), errors, warnings: [] };
}

/**
 * DOMParser's error, if any, with the offset it names: browsers report a parsererror element.
 * @param {Document} dom
 * @param {Uint32Array} lines
 */
function parseError(dom, lines) {
  const error = dom.getElementsByTagName("parsererror")[0];
  if (!error) return undefined;
  const ns = error.namespaceURI ?? "";
  if (dom.documentElement !== error && !/parsererror|xhtml/.test(ns)) return undefined;
  const detail = error.querySelector("div")?.textContent ?? error.textContent ?? "";
  let offset = 0;
  let message = detail.trim();
  for (const pattern of LOCATION) {
    const m = pattern.exec(detail);
    if (!m) continue;
    const line = Math.max(1, Number(m[1]));
    const col = Math.max(1, Number(m[2]));
    offset = Math.min((lines[line - 1] ?? 0) + col - 1, lines[line] ?? Number.MAX_SAFE_INTEGER);
    message =
      detail
        .slice((m.index ?? 0) + m[0].length)
        .replace(/^[:\s]+/, "")
        .split("\n")[0] ?? "";
    break;
  }
  message = message.trim() || "The XML is not well-formed.";
  return { offset, message: /[.!?]$/.test(message) ? message : `${message}.` };
}

class Builder {
  /** @param {Uint32Array} lines @param {boolean} trim */
  constructor(lines, trim) {
    this.lines = lines;
    this.trim = trim;
  }

  /** @param {number} at */
  where(at) {
    return positionOf(this.lines, at);
  }

  /** @param {string} name */
  named(name) {
    const colon = name.indexOf(":");
    return colon > 0 ? { prefix: name.slice(0, colon) } : {};
  }

  /** @param {string} value */
  text(value) {
    return this.trim ? value.trim() : value;
  }

  /**
   * An element from the DOM, its positions from the scanned elements in the same order.
   * @param {Element} element
   * @param {ScannedElement[]} scanned
   * @param {{ next: number }} [order]
   * @returns {DataNode}
   */
  fromDom(element, scanned, order = { next: 0 }) {
    const found = scanned[order.next];
    const match = found && found.name === element.nodeName ? found : undefined;
    order.next++;
    const at = match?.at ?? 0;
    /** @type {DataNode[]} */
    const children = [];
    for (const attr of Array.from(element.attributes)) {
      const place = match?.attrs.find((a) => a.name === attr.name);
      children.push({
        kind: "string",
        key: `@${attr.name}`,
        value: attr.value,
        tag: "attribute",
        ...this.named(attr.name),
        ...this.where(place?.at ?? at),
        from: place?.from ?? at,
        to: place?.to ?? at,
      });
    }
    let texts = 0;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === ELEMENT) {
        children.push(this.fromDom(/** @type {Element} */ (child), scanned, order));
      } else if (child.nodeType === TEXT || child.nodeType === CDATA) {
        const value = child.nodeValue ?? "";
        const cdata = child.nodeType === CDATA;
        if (!cdata && value.trim() === "") continue;
        const place = match?.texts[texts++];
        children.push({
          kind: "string",
          key: cdata ? "#cdata" : "#text",
          value: cdata ? value : this.text(value),
          tag: cdata ? "cdata" : "text",
          ...this.where(place?.from ?? at),
          from: place?.from ?? at,
          to: place?.to ?? at,
        });
      }
    }
    return {
      kind: "element",
      key: element.nodeName,
      children,
      ...this.named(element.nodeName),
      ...this.where(at),
      from: at,
      to: match?.end ?? at,
    };
  }

  /**
   * An element as the reader saw it, for a document DOMParser refused.
   * @param {ScannedElement} element
   * @returns {DataNode}
   */
  fromScan(element) {
    /** @type {DataNode[]} */
    const children = element.attrs.map((a) => ({
      kind: /** @type {const} */ ("string"),
      key: `@${a.name}`,
      value: a.value,
      tag: "attribute",
      ...this.named(a.name),
      ...this.where(a.at),
      from: a.from,
      to: a.to,
    }));
    // Text and elements in document order.
    const items = [
      ...element.texts.map((t) => ({ at: t.from, node: this.scannedText(t) })),
      ...element.kids.map((k) => ({ at: k.at, node: this.fromScan(k) })),
    ].sort((a, b) => a.at - b.at);
    children.push(...items.map((item) => item.node));
    return {
      kind: "element",
      key: element.name,
      children,
      ...this.named(element.name),
      ...this.where(element.at),
      from: element.at,
      to: element.end,
    };
  }

  /** @param {import("./xml-scan.js").ScannedText} t @returns {DataNode} */
  scannedText(t) {
    return {
      kind: "string",
      key: t.cdata ? "#cdata" : "#text",
      value: t.cdata ? t.value : this.text(t.value),
      tag: t.cdata ? "cdata" : "text",
      ...this.where(t.from),
      from: t.from,
      to: t.to,
    };
  }
}
