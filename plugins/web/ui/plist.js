// Property lists, binary (bplist00) and XML, as Safari writes .webarchive and .webloc files. Values
// come back as plain JavaScript: objects, arrays, strings, numbers, booleans, Dates and Uint8Arrays.
import { fromBase64, latin1, startsWith } from "./bytes.js";

/** @typedef {null | boolean | number | string | Date | Uint8Array | PlistValue[] | { [key: string]: PlistValue }} PlistValue */

const EPOCH_2001 = Date.UTC(2001, 0, 1);

/** @param {Uint8Array} bytes @returns {PlistValue} */
export function readPlist(bytes) {
  if (startsWith(bytes, "bplist00")) return readBinary(bytes);
  return readXml(new TextDecoder().decode(bytes));
}

/** @param {Uint8Array} bytes */
function readBinary(bytes) {
  if (bytes.length < 40) throw new Error("The property list is cut short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uint = (/** @type {number} */ at, /** @type {number} */ size) => {
    if (at < 0 || at + size > bytes.length) throw new Error("The property list is damaged.");
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + (bytes[at + i] ?? 0);
    return value;
  };
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6] ?? 0;
  const refSize = bytes[trailer + 7] ?? 0;
  const count = uint(trailer + 8, 8);
  const top = uint(trailer + 16, 8);
  const table = uint(trailer + 24, 8);
  if (!offsetSize || !refSize || top >= count || table + count * offsetSize > trailer)
    throw new Error("The property list is damaged.");
  /** @type {Set<number>} */
  const open = new Set();

  /** @returns {PlistValue} */
  const object = (/** @type {number} */ ref) => {
    if (ref >= count || open.has(ref) || open.size > 512)
      throw new Error("The property list is damaged.");
    open.add(ref);
    try {
      return parse(uint(table + ref * offsetSize, offsetSize));
    } finally {
      open.delete(ref);
    }
  };
  /** The length in a marker's low nibble, or in the integer after it when the nibble is 15. */
  const lengthAt = (/** @type {number} */ at) => {
    const low = (bytes[at] ?? 0) & 15;
    if (low !== 15) return [low, at + 1];
    const size = 1 << ((bytes[at + 1] ?? 0) & 15);
    return [uint(at + 2, size), at + 2 + size];
  };
  /** @returns {PlistValue} */
  const parse = (/** @type {number} */ at) => {
    const marker = bytes[at] ?? 0;
    const high = marker >> 4;
    const low = marker & 15;
    if (marker === 0x00) return null;
    if (marker === 0x08) return false;
    if (marker === 0x09) return true;
    if (high === 1) {
      const size = 1 << low;
      if (size === 8 && (bytes[at + 1] ?? 0) & 0x80) return Number(view.getBigInt64(at + 1));
      return uint(at + 1, size);
    }
    if (high === 2) return low === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
    if (marker === 0x33) return new Date(EPOCH_2001 + view.getFloat64(at + 1) * 1000);
    const [length, start] = lengthAt(at);
    if (high === 4) return bytes.slice(start, start + length);
    if (high === 5) return latin1(bytes, start, start + length);
    if (high === 6) {
      let text = "";
      for (let i = 0; i < length; i++) text += String.fromCharCode(uint(start + i * 2, 2));
      return text;
    }
    if (high === 7) return new TextDecoder().decode(bytes.subarray(start, start + length));
    if (high === 8) return uint(at + 1, low + 1);
    if (high === 10 || high === 12)
      return Array.from({ length }, (_, i) => object(uint(start + i * refSize, refSize)));
    if (high === 13) {
      /** @type {{ [key: string]: PlistValue }} */
      const dict = {};
      for (let i = 0; i < length; i++) {
        const key = object(uint(start + i * refSize, refSize));
        dict[String(key)] = object(uint(start + (length + i) * refSize, refSize));
      }
      return dict;
    }
    throw new Error("The property list holds a value Web does not read.");
  };
  return object(top);
}

const ENTITIES = /** @type {Record<string, string>} */ ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
});
const decodeEntities = (/** @type {string} */ text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) =>
    name[0] === "#"
      ? String.fromCodePoint(
          Number.parseInt(name.slice(name[1] === "x" ? 2 : 1), name[1] === "x" ? 16 : 10),
        )
      : (ENTITIES[name] ?? whole),
  );

/** An XML property list, read with a small tokenizer: the format is regular, no DOM needed. */
function readXml(/** @type {string} */ text) {
  const tokens = [
    ...text
      .replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, "")
      .matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g),
  ];
  let i = 0;
  const skipText = () => {
    while (tokens[i]?.[4] !== undefined && !tokens[i]?.[4]?.trim()) i++;
  };
  /** @returns {PlistValue} */
  const value = () => {
    skipText();
    const token = tokens[i++];
    if (!token || token[4] !== undefined || token[1])
      throw new Error("The property list is damaged.");
    const tag = token[2] ?? "";
    if (token[3]) {
      if (tag === "true" || tag === "false") return tag === "true";
      if (tag === "dict") return {};
      if (tag === "array") return [];
      return tag === "data" ? new Uint8Array(0) : "";
    }
    if (tag === "plist") {
      const inner = value();
      skipText();
      i++;
      return inner;
    }
    if (tag === "dict") {
      /** @type {{ [key: string]: PlistValue }} */
      const dict = {};
      for (;;) {
        skipText();
        const next = tokens[i];
        if (!next) throw new Error("The property list is damaged.");
        if (next[1]) {
          i++;
          return dict;
        }
        const key = value();
        dict[String(key)] = value();
      }
    }
    if (tag === "array") {
      /** @type {PlistValue[]} */
      const list = [];
      for (;;) {
        skipText();
        if (!tokens[i]) throw new Error("The property list is damaged.");
        if (tokens[i]?.[1]) {
          i++;
          return list;
        }
        list.push(value());
      }
    }
    if (tag === "true" || tag === "false") {
      i++;
      return tag === "true";
    }
    const body = tokens[i]?.[4] !== undefined ? decodeEntities(tokens[i++]?.[4] ?? "") : "";
    i++;
    if (tag === "integer" || tag === "real") return Number(body.trim());
    if (tag === "date") return new Date(body.trim());
    if (tag === "data") return fromBase64(body);
    return body;
  };
  return value();
}
