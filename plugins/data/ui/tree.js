// The one typed tree every format parses into, and what the view, search and the schema check read
// from it. A node is a plain object that knows its line and column. A container holds its children,
// or builds them the first time they are asked for (JSON's lazy tree), so a 50 MB file costs what
// is opened. Numbers and dates keep the text they were written with.

/**
 * @typedef {"object" | "array" | "string" | "number" | "boolean" | "null" | "date" | "binary" | "element"} Kind
 * @typedef {{ children(ref: number): DataNode[] }} Lazy
 * @typedef {object} DataNode
 * @property {Kind} kind
 * @property {string | number} [key] A member's name, an array element's index, an element's name
 * @property {string | boolean | null | Uint8Array} [value] A scalar; numbers and dates as written
 * @property {number} line 1-based; a member's line is its key's
 * @property {number} col 1-based
 * @property {number} [offset] Where a node of a binary format starts, in bytes
 * @property {number} [from] Where the value's source starts (characters; bytes in binary formats)
 * @property {number} [to] Where the value's source ends
 * @property {DataNode[]} [children] A container's children, once built
 * @property {Lazy} [lazy] Builds the children of a lazy container
 * @property {number} [ref] The container's number for `lazy`
 * @property {number} [count] How many children a container has, known before they are built
 * @property {string} [tag] A type tag: YAML's !!str, CBOR's tag 1, TOML's local date, HCL's block
 * @property {string} [prefix] An XML name's prefix
 * @property {string} [anchor] The YAML anchor on this node
 * @property {string} [alias] The YAML anchor this node points to; it shows that node
 * @property {boolean} [duplicate] A key seen before in the same object
 * @property {boolean} [secret] Always masked (dotenv values)
 * @property {string} [error] Why a root did not parse (a bad JSON Lines line)
 *
 * @typedef {{ message: string, line: number, col: number }} ParseError
 * @typedef {object} DataDoc
 * @property {DataNode[]} roots One per document, or per line of JSON Lines
 * @property {ParseError[]} errors The first error ends a document; JSON Lines has one per bad line
 * @property {ParseError[]} [warnings] Duplicate keys and the like
 * @property {"Document" | "Line"} [rootLabel] What a root is called when there are several
 * @property {Array<[number, number]>} [secretRanges] Value ranges under secret-looking keys, from
 *   parsers whose tree is lazy and that found them in their one pass
 */

/** @param {DataNode} node */
export const isBranch = (node) =>
  node.kind === "object" || node.kind === "array" || node.kind === "element";

/**
 * A container's children, built on first use. With `keep` false a lazy container builds them
 * without keeping them, as search does on its way through a large file.
 * @param {DataNode} node
 * @returns {DataNode[]}
 */
export function childrenOf(node, keep = true) {
  if (node.children) return node.children;
  if (!node.lazy || node.ref === undefined) return [];
  const children = node.lazy.children(node.ref);
  if (keep) node.children = children;
  return children;
}

/** @param {DataNode} node */
export const countOf = (node) => node.children?.length ?? node.count ?? 0;

/**
 * A number's value from the text it was written with: signs, `_`, hex, octal and binary, and every
 * format's infinities and NaN.
 * @param {DataNode} node
 */
export function numberOf(node) {
  let text = String(node.value ?? "").replace(/_/g, "");
  let sign = 1;
  if (text.startsWith("-") || text.startsWith("+")) {
    if (text.startsWith("-")) sign = -1;
    text = text.slice(1);
  }
  const lower = text.toLowerCase();
  if (lower === "inf" || lower === ".inf" || lower === "infinity") return sign * Infinity;
  if (lower === "nan" || lower === ".nan") return Number.NaN;
  return sign * Number(text);
}

/**
 * The node as a plain value: objects and elements as objects (the last duplicate wins), numbers as
 * numbers, dates as their text, binary data as its bytes.
 * @param {DataNode} node
 * @returns {unknown}
 */
export function plainOf(node) {
  if (node.kind === "array") return childrenOf(node).map(plainOf);
  if (node.kind === "object" || node.kind === "element") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const child of childrenOf(node)) out[String(child.key)] = plainOf(child);
    return out;
  }
  if (node.kind === "number") return numberOf(node);
  return node.value ?? null;
}

const SIMPLE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const XML_NAME = /^@?[A-Za-z_][\w.:-]*$/;
/** @param {string} key */
const escapeSegment = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * The JSON Pointer of the last node of a chain (root first). Under an array or an XML element a
 * segment is the child's index.
 * @param {DataNode[]} chain
 */
export function pointerOf(chain) {
  let out = "";
  for (let i = 1; i < chain.length; i++) {
    const parent = /** @type {DataNode} */ (chain[i - 1]);
    const child = /** @type {DataNode} */ (chain[i]);
    const segment =
      parent.kind === "object" ? String(child.key) : String(indexIn(parent, child, child.key));
    out += `/${escapeSegment(segment)}`;
  }
  return out;
}

/**
 * @param {DataNode} parent
 * @param {DataNode} child
 * @param {unknown} fallback
 */
const indexIn = (parent, child, fallback) => {
  if (parent.kind === "array" && typeof child.key === "number") return child.key;
  const index = childrenOf(parent).indexOf(child);
  return index >= 0 ? index : fallback;
};

/**
 * The dotted path of the last node of a chain: `servers[0].name`, `["a b"].c`, and for XML
 * `catalog.book[1].@id`.
 * @param {DataNode[]} chain
 */
export function pathOf(chain) {
  let out = "";
  for (let i = 1; i < chain.length; i++) {
    const parent = /** @type {DataNode} */ (chain[i - 1]);
    const child = /** @type {DataNode} */ (chain[i]);
    const key = String(child.key);
    if (parent.kind === "array") out += `[${key}]`;
    else if (parent.kind === "element" && XML_NAME.test(key)) {
      const same = childrenOf(parent).filter((c) => c.key === child.key);
      const nth = same.length > 1 ? `[${same.indexOf(child)}]` : "";
      out += `${out === "" ? "" : "."}${key}${nth}`;
    } else if (SIMPLE.test(key)) out += `${out === "" ? "" : "."}${key}`;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out;
}

/**
 * The chain from `root` to the node a JSON Pointer names, or undefined.
 * @param {DataNode} root
 * @param {string} pointer
 */
export function resolve(root, pointer) {
  const chain = [root];
  if (pointer === "") return chain;
  if (!pointer.startsWith("/")) return undefined;
  let at = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    const children = childrenOf(at);
    const next =
      at.kind === "object"
        ? children.find((child) => child.key === segment)
        : /^\d+$/.test(segment)
          ? children[Number(segment)]
          : undefined;
    if (!next) return undefined;
    chain.push(next);
    at = next;
  }
  return chain;
}

/** @param {number} n @param {string} one @param {string} many */
const counted = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** @param {Uint8Array} bytes */
export const hexOf = (bytes, max = 16) =>
  [...bytes.subarray(0, max)].map((b) => b.toString(16).padStart(2, "0")).join(" ");

/**
 * What a tree row shows for a node: a scalar's value, or a container's child count.
 * @param {DataNode} node
 */
export function previewOf(node) {
  const n = countOf(node);
  if (node.kind === "array") return counted(n, "item", "items");
  if (node.kind === "object") return counted(n, "key", "keys");
  if (node.kind === "element") return counted(n, "child", "children");
  if (node.kind === "binary") {
    const bytes = node.value instanceof Uint8Array ? node.value : new Uint8Array();
    const more = bytes.length > 16 ? " …" : "";
    return `${counted(bytes.length, "byte", "bytes")}: ${hexOf(bytes)}${more}`.replace(/: $/, "");
  }
  if (node.kind === "string") {
    const text = String(node.value ?? "");
    if (node.tag === "expression" || node.tag === "template") return clip(text);
    return clip(JSON.stringify(text));
  }
  return clip(String(node.value ?? "null"));
}

/** @param {string} text */
const clip = (text, max = 300) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The text search matches against a scalar: a string's value, a number or date as written.
 * @param {DataNode} node
 */
export function textOf(node) {
  if (node.kind === "binary") return previewOf(node);
  if (node.kind === "null") return "null";
  return String(node.value ?? "");
}
