// CBOR (RFC 8949) into the typed tree: integers (64-bit ones and bignums as written), byte and text
// strings, arrays and maps (with indefinite lengths), tags (dates for 0 and 1, bignums for 2 and 3,
// the self-describe tag skipped, any other kept as the node's tag), simple values and half, single
// and double floats. A CBOR sequence gives one root per item.

import { bytesPosition, dateText } from "./binary.js";
import { keyOf, Reader } from "./bytes.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

const BREAK = Symbol("break");

/** @param {Uint8Array} bytes @returns {DataDoc} */
export function parseCbor(bytes) {
  const r = new Reader(bytes);
  /** @type {DataNode[]} */
  const roots = [];
  const errors = [];
  try {
    while (r.pos < bytes.length) {
      if (read(r, roots, undefined, 0) === BREAK)
        throw r.bad(r.pos - 1, "a break outside an indefinite item");
    }
  } catch (error) {
    errors.push(r.failure(error, "CBOR"));
  }
  return { roots, errors, warnings: [], rootLabel: "Document" };
}

/** The argument of an initial byte: its count, length or value. -1 is indefinite. */
function argument(/** @type {Reader} */ r, /** @type {number} */ info) {
  if (info < 24) return BigInt(info);
  if (info <= 27) return r.big(1 << (info - 24), false);
  if (info === 31) return -1n;
  throw r.bad(r.pos - 1, `the additional information ${info} is reserved`);
}

/** @param {number} h A half float's 16 bits. */
function half(h) {
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  const sign = h & 0x8000 ? -1 : 1;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant === 0 ? sign * Infinity : Number.NaN;
  return sign * (mant + 1024) * 2 ** (exp - 25);
}

/**
 * Decode one item into `into` (attached before its children are read); BREAK for 0xff.
 * @param {Reader} r
 * @param {DataNode[]} into
 * @param {string | number | undefined} key
 * @param {number} depth
 * @param {number} [at]
 * @returns {DataNode | typeof BREAK}
 */
function read(r, into, key, depth, at = r.pos) {
  r.deep(depth);
  const start = r.pos;
  const b = r.u8();
  if (b === 0xff) return BREAK;
  const major = b >> 5;
  const info = b & 0x1f;
  const base = { ...bytesPosition(at), offset: at, ...(key === undefined ? {} : { key }) };
  /** @param {Omit<DataNode, "line" | "col">} node */
  const put = (node) => {
    const full = /** @type {DataNode} */ ({ ...node, ...base });
    into.push(full);
    return full;
  };
  if (major === 7) {
    if (info === 20 || info === 21)
      return put({ kind: "boolean", value: info === 21, from: start, to: r.pos });
    if (info === 22) return put({ kind: "null", value: null, from: start, to: r.pos });
    if (info === 23)
      return put({ kind: "null", value: null, tag: "undefined", from: start, to: r.pos });
    if (info === 25)
      return put({
        kind: "number",
        value: String(half(Number(r.big(2, false)))),
        from: start,
        to: r.pos,
      });
    if (info === 26) return put({ kind: "number", value: String(r.f32()), from: start, to: r.pos });
    if (info === 27) return put({ kind: "number", value: String(r.f64()), from: start, to: r.pos });
    const simple = info === 24 ? r.u8() : info;
    return put({ kind: "number", value: String(simple), tag: "simple", from: start, to: r.pos });
  }
  const arg = argument(r, info);
  if (major === 0) return put({ kind: "number", value: String(arg), from: start, to: r.pos });
  if (major === 1) return put({ kind: "number", value: String(-1n - arg), from: start, to: r.pos });
  if (major === 2 || major === 3) {
    const from = r.pos;
    /** @type {Uint8Array[]} */
    const parts = [];
    if (arg < 0n) {
      for (;;) {
        const chunk = r.u8();
        if (chunk === 0xff) break;
        if (chunk >> 5 !== major)
          throw r.bad(r.pos - 1, "a chunk of another type in an indefinite string");
        const size = argument(r, chunk & 0x1f);
        if (size < 0n) throw r.bad(r.pos - 1, "a nested indefinite string");
        parts.push(r.take(Number(size)));
      }
    } else parts.push(r.take(Number(arg)));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (major === 2) return put({ kind: "binary", value: bytes, from, to: r.pos });
    return put({ kind: "string", value: new TextDecoder().decode(bytes), from, to: r.pos });
  }
  if (major === 4 || major === 5) {
    /** @type {DataNode[]} */
    const children = [];
    const node = put({ kind: major === 4 ? "array" : "object", children, from: start });
    const count = arg < 0n ? Infinity : Number(arg);
    for (let i = 0; i < count; i++) {
      const itemAt = r.pos;
      if (major === 4) {
        if (read(r, children, i, depth + 1) === BREAK) {
          if (count !== Infinity) throw r.bad(itemAt, "a break in a definite array");
          break;
        }
        continue;
      }
      /** @type {DataNode[]} */
      const keys = [];
      if (read(r, keys, undefined, depth + 1) === BREAK) {
        if (count !== Infinity) throw r.bad(itemAt, "a break in a definite map");
        break;
      }
      if (read(r, children, keyOf(keys[0]), depth + 1, itemAt) === BREAK)
        throw r.bad(r.pos - 1, "a map key without a value");
    }
    node.to = r.pos;
    return node;
  }
  // major 6: a tag on the next item.
  if (arg === 55799n) return read(r, into, key, depth + 1, at);
  /** @type {DataNode[]} */
  const inner = [];
  const item = read(r, inner, key, depth + 1, at);
  if (item === BREAK) throw r.bad(r.pos - 1, "a tag on a break");
  const node = /** @type {DataNode} */ (inner[0]);
  node.tag = `tag ${arg}`;
  if (arg === 0n && node.kind === "string") node.kind = "date";
  else if (arg === 1n && node.kind === "number") {
    node.kind = "date";
    node.value = dateText(Number(node.value) * 1000);
  } else if ((arg === 2n || arg === 3n) && node.value instanceof Uint8Array) {
    let n = 0n;
    for (const byte of node.value) n = (n << 8n) | BigInt(byte);
    node.kind = "number";
    node.value = String(arg === 3n ? -1n - n : n);
  }
  into.push(node);
  return node;
}
