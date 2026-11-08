// MessagePack into the typed tree: maps, arrays, strings, integers (64-bit ones as written),
// floats, booleans, nil, bin, ext and the timestamp ext (-1) as a date. A stream of several values
// gives one root each. Each node knows its byte offset; data cut short keeps what decoded.

import { bytesPosition, dateText } from "./binary.js";
import { keyOf, Reader } from "./bytes.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

/** @param {Uint8Array} bytes @returns {DataDoc} */
export function parseMsgpack(bytes) {
  const r = new Reader(bytes);
  /** @type {DataNode[]} */
  const roots = [];
  const errors = [];
  try {
    while (r.pos < bytes.length) read(r, roots, undefined, 0);
  } catch (error) {
    errors.push(r.failure(error, "MessagePack"));
  }
  return { roots, errors, warnings: [], rootLabel: "Document" };
}

/**
 * Decode one value at the cursor into `into`, attached before its children are read.
 * @param {Reader} r
 * @param {DataNode[]} into
 * @param {string | number | undefined} key
 * @param {number} depth
 * @param {number} [at] Where the member starts (its key) when it is a map's value.
 */
function read(r, into, key, depth, at = r.pos) {
  r.deep(depth);
  const start = r.pos;
  const b = r.u8();
  const base = { ...bytesPosition(at), offset: at, ...(key === undefined ? {} : { key }) };
  /** @param {Omit<DataNode, "line" | "col">} node */
  const put = (node) => {
    const full = /** @type {DataNode} */ ({ ...node, ...base });
    into.push(full);
    return full;
  };
  const scalar = (
    /** @type {DataNode["kind"]} */ kind,
    /** @type {DataNode["value"]} */ value,
    from = start,
  ) => put({ kind, value, from, to: r.pos });
  if (b <= 0x7f) return scalar("number", String(b));
  if (b >= 0xe0) return scalar("number", String(b - 0x100));
  if (b >= 0x80 && b <= 0x8f) return map(r, put, b & 0x0f, depth);
  if (b >= 0x90 && b <= 0x9f) return array(r, put, b & 0x0f, depth);
  if (b >= 0xa0 && b <= 0xbf) return str(r, scalar, b & 0x1f);
  switch (b) {
    case 0xc0:
      return scalar("null", null);
    case 0xc2:
    case 0xc3:
      return scalar("boolean", b === 0xc3);
    case 0xc4:
    case 0xc5:
    case 0xc6: {
      const size = r.uint(1 << (b - 0xc4));
      const from = r.pos;
      return scalar("binary", r.take(size), from);
    }
    case 0xc7:
    case 0xc8:
    case 0xc9:
      return ext(r, put, r.uint(1 << (b - 0xc7)), start);
    case 0xca:
      return scalar("number", String(r.f32()));
    case 0xcb:
      return scalar("number", String(r.f64()));
    case 0xcc:
    case 0xcd:
    case 0xce:
    case 0xcf:
      return scalar("number", String(r.big(1 << (b - 0xcc), false)));
    case 0xd0:
    case 0xd1:
    case 0xd2:
    case 0xd3:
      return scalar("number", String(r.big(1 << (b - 0xd0), true)));
    case 0xd4:
    case 0xd5:
    case 0xd6:
    case 0xd7:
    case 0xd8:
      return ext(r, put, 1 << (b - 0xd4), start);
    case 0xd9:
    case 0xda:
    case 0xdb:
      return str(r, scalar, r.uint(1 << (b - 0xd9)));
    case 0xdc:
    case 0xdd:
      return array(r, put, r.uint(b === 0xdc ? 2 : 4), depth);
    case 0xde:
    case 0xdf:
      return map(r, put, r.uint(b === 0xde ? 2 : 4), depth);
    default:
      throw r.bad(start, `0x${b.toString(16)} is not a MessagePack type`);
  }
}

/**
 * @param {Reader} r
 * @param {(kind: DataNode["kind"], value: DataNode["value"], from?: number) => DataNode} scalar
 * @param {number} size
 */
function str(r, scalar, size) {
  const from = r.pos;
  return scalar("string", r.text(size), from);
}

/**
 * @param {Reader} r
 * @param {(node: Omit<DataNode, "line" | "col">) => DataNode} put
 * @param {number} count
 * @param {number} depth
 */
function array(r, put, count, depth) {
  /** @type {DataNode[]} */
  const children = [];
  const node = put({ kind: "array", children, from: r.pos - 1 });
  for (let i = 0; i < count; i++) read(r, children, i, depth + 1);
  node.to = r.pos;
  return node;
}

/**
 * @param {Reader} r
 * @param {(node: Omit<DataNode, "line" | "col">) => DataNode} put
 * @param {number} count
 * @param {number} depth
 */
function map(r, put, count, depth) {
  /** @type {DataNode[]} */
  const children = [];
  const node = put({ kind: "object", children, from: r.pos - 1 });
  for (let i = 0; i < count; i++) {
    const at = r.pos;
    /** @type {DataNode[]} */
    const keys = [];
    read(r, keys, undefined, depth + 1);
    read(r, children, keyOf(/** @type {DataNode} */ (keys[0])), depth + 1, at);
  }
  node.to = r.pos;
  return node;
}

/**
 * An ext value: the timestamp (-1) as a date, any other as its bytes.
 * @param {Reader} r
 * @param {(node: Omit<DataNode, "line" | "col">) => DataNode} put
 * @param {number} size
 * @param {number} start
 */
function ext(r, put, size, start) {
  const type = r.i8();
  const from = r.pos;
  const data = r.take(size);
  if (type === -1 && (size === 4 || size === 8 || size === 12)) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let seconds;
    let nanos = 0;
    if (size === 4) seconds = view.getUint32(0);
    else if (size === 8) {
      const high = view.getUint32(0);
      nanos = high >>> 2;
      seconds = (high & 0x3) * 2 ** 32 + view.getUint32(4);
    } else {
      nanos = view.getUint32(0);
      seconds = Number(view.getBigInt64(4));
    }
    return put({
      kind: "date",
      value: dateText(seconds * 1000 + nanos / 1e6),
      tag: "timestamp",
      from,
      to: r.pos,
    });
  }
  return put({ kind: "binary", value: data, tag: `ext ${type}`, from: start, to: r.pos });
}
