// Bytes as a 7z header holds them: the integers the codecs read too, UTF-8 and UTF-16LE text, and
// Windows FILETIME dates. Pure functions over Uint8Array.
export { at, u32, u64 } from "../codecs/bytes.js";

const utf8Decoder = new TextDecoder("utf-8");
const utf16Decoder = new TextDecoder("utf-16le");
/** @param {Uint8Array} b */
export const utf8 = (b) => utf8Decoder.decode(b);
/** @param {Uint8Array} b */
export const utf16le = (b) => utf16Decoder.decode(b);

/** A Windows FILETIME: 100 ns steps since 1601 (UTC), from its two halves. */
export function fileTime(/** @type {number} */ low, /** @type {number} */ high) {
  const ms = (high * 0x100000000 + low) / 10000 - 11644473600000;
  return high || low ? new Date(Math.round(ms)) : undefined;
}
