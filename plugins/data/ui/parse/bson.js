// BSON into the typed tree: documents and arrays with every element type of the BSON 1.1 spec
// (doubles, strings, binary data, ObjectIds, dates, regular expressions, code, 32- and 64-bit
// integers, timestamps and decimal128 as written). A file of several documents, as mongodump writes
// them, gives one root each.

import { bytesPosition, dateText } from "./binary.js";
import { Reader } from "./bytes.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

/** @param {Uint8Array} bytes @returns {DataDoc} */
export function parseBson(bytes) {
  const r = new Reader(bytes);
  /** @type {DataNode[]} */
  const roots = [];
  const errors = [];
  try {
    while (r.pos < bytes.length) {
      const at = r.pos;
      document(r, roots, undefined, false, 0, at);
    }
  } catch (error) {
    errors.push(r.failure(error, "BSON"));
  }
  return { roots, errors, warnings: [], rootLabel: "Document" };
}

/**
 * A document (or an array, whose keys are its indexes) at the cursor, into `into`.
 * @param {Reader} r
 * @param {DataNode[]} into
 * @param {string | number | undefined} key
 * @param {boolean} isArray
 * @param {number} depth
 * @param {number} at Where its element starts.
 */
function document(r, into, key, isArray, depth, at) {
  r.deep(depth);
  const start = r.pos;
  const size = Number(r.big(4, true, true));
  const end = start + size;
  if (size < 5 || end > r.bytes.length) throw r.bad(start, `a document of ${size} bytes`);
  /** @type {DataNode[]} */
  const children = [];
  /** @type {DataNode} */
  const node = {
    kind: isArray ? "array" : "object",
    children,
    ...bytesPosition(at),
    offset: at,
    from: start,
    to: end,
    ...(key === undefined ? {} : { key }),
  };
  into.push(node);
  while (r.pos < end - 1) {
    const elementAt = r.pos;
    const type = r.u8();
    const name = r.cstring();
    element(r, children, isArray ? children.length : name, type, depth, elementAt);
  }
  if (r.u8() !== 0) throw r.bad(r.pos - 1, "a document that does not end with 0");
  return node;
}

/**
 * One element's value.
 * @param {Reader} r
 * @param {DataNode[]} into
 * @param {string | number} key
 * @param {number} type
 * @param {number} depth
 * @param {number} at
 */
function element(r, into, key, type, depth, at) {
  if (type === 0x03 || type === 0x04) {
    document(r, into, key, type === 0x04, depth + 1, at);
    return;
  }
  const from = r.pos;
  /** @param {DataNode["kind"]} kind @param {DataNode["value"]} value @param {string} [tag] */
  const put = (kind, value, tag) => {
    /** @type {DataNode} */
    const node = { kind, key, value, ...bytesPosition(at), offset: at, from, to: r.pos };
    if (tag) node.tag = tag;
    into.push(node);
  };
  const string = () => {
    const size = Number(r.big(4, true, true));
    if (size < 1) throw r.bad(r.pos - 4, "a string without its NUL");
    const value = r.text(size - 1);
    r.u8();
    return value;
  };
  switch (type) {
    case 0x01:
      return put("number", String(r.f64(true)));
    case 0x02:
      return put("string", string());
    case 0x05: {
      const size = Number(r.big(4, true, true));
      const subtype = r.u8();
      const data = r.take(size);
      return put("binary", data, subtype === 0 ? undefined : `subtype ${subtype}`);
    }
    case 0x06:
      return put("null", null, "undefined");
    case 0x07:
      return put("string", hex(r.take(12)), "ObjectId");
    case 0x08:
      return put("boolean", r.u8() !== 0);
    case 0x09:
      return put("date", dateText(Number(r.big(8, true, true))));
    case 0x0a:
      return put("null", null);
    case 0x0b: {
      const pattern = r.cstring();
      return put("string", `/${pattern}/${r.cstring()}`, "regex");
    }
    case 0x0c: {
      const ref = string();
      return put("string", `${ref} ${hex(r.take(12))}`, "DBPointer");
    }
    case 0x0d:
      return put("string", string(), "code");
    case 0x0e:
      return put("string", string(), "symbol");
    case 0x0f: {
      r.big(4, true, true);
      const code = string();
      /** @type {DataNode[]} */
      const scope = [];
      document(r, scope, "scope", false, depth + 1, r.pos);
      return put("string", code, "code with scope");
    }
    case 0x10:
      return put("number", String(r.big(4, true, true)));
    case 0x11:
      return put("number", String(r.big(8, false, true)), "timestamp");
    case 0x12:
      return put("number", String(r.big(8, true, true)));
    case 0x13:
      return put("number", decimal128(r.take(16)), "decimal128");
    case 0xff:
      return put("string", "MinKey", "MinKey");
    case 0x7f:
      return put("string", "MaxKey", "MaxKey");
    default:
      throw r.bad(at, `0x${type.toString(16)} is not a BSON element type`);
  }
}

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A decimal128 (IEEE 754-2008, binary integer decimal) as text. */
function decimal128(/** @type {Uint8Array} */ bytes) {
  let bits = 0n;
  for (let i = 15; i >= 0; i--) bits = (bits << 8n) | BigInt(bytes[i] ?? 0);
  const negative = (bits >> 127n) & 1n;
  const combination = (bits >> 122n) & 0x1fn;
  if (combination === 0x1fn) return "NaN";
  if (combination === 0x1en) return negative ? "-Infinity" : "Infinity";
  const twoHigh = (bits >> 125n) & 0x3n;
  const exponent = twoHigh === 0x3n ? (bits >> 111n) & 0x3fffn : (bits >> 113n) & 0x3fffn;
  const coefficient = twoHigh === 0x3n ? 0n : bits & ((1n << 113n) - 1n);
  const scale = Number(exponent) - 6176;
  let digits = coefficient.toString();
  if (scale > 0) digits += "0".repeat(scale);
  else if (scale < 0) {
    digits = digits.padStart(-scale + 1, "0");
    digits = `${digits.slice(0, scale)}.${digits.slice(scale)}`;
  }
  return `${negative ? "-" : ""}${digits}`;
}
