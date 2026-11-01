// Bytes: readers for both byte orders, inflate through DecompressionStream, and the error a decoder
// throws with the sentence the person reads.

/** A decoder's failure, in words for the details view. */
export class Unreadable extends Error {}

/** @param {string} message @returns {never} */
export const fail = (message) => {
  throw new Unreadable(message);
};

/** @param {Uint8Array} bytes @param {number} at @param {number} length */
export const ascii = (bytes, at, length) => {
  let text = "";
  for (let i = at; i < Math.min(bytes.length, at + length); i++)
    text += String.fromCharCode(bytes[i] ?? 0);
  return text;
};

/** Whether `bytes` holds `magic` (a string of byte values, or numbers) at `at`. */
export const has = (
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ at,
  /** @type {string | number[]} */ magic,
) => {
  const values = typeof magic === "string" ? Array.from(magic, (c) => c.charCodeAt(0)) : magic;
  if (at + values.length > bytes.length) return false;
  return values.every((v, i) => bytes[at + i] === v);
};

/**
 * Readers that never throw a RangeError: past the end they fail with words.
 * @param {Uint8Array} bytes
 * @param {boolean} [le] little-endian
 */
export function reader(bytes, le = true) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (/** @type {number} */ at, /** @type {number} */ n) => {
    if (at < 0 || at + n > bytes.length) fail("The file ends before its header does.");
  };
  /** @param {(at: number) => number} read @param {number} n */
  const checked = (read, n) => (/** @type {number} */ at) => {
    need(at, n);
    return read(at);
  };
  return {
    bytes,
    le,
    length: bytes.length,
    u8: checked((at) => view.getUint8(at), 1),
    i8: checked((at) => view.getInt8(at), 1),
    u16: checked((at) => view.getUint16(at, le), 2),
    i16: checked((at) => view.getInt16(at, le), 2),
    u32: checked((at) => view.getUint32(at, le), 4),
    i32: checked((at) => view.getInt32(at, le), 4),
    f32: checked((at) => view.getFloat32(at, le), 4),
    f64: checked((at) => view.getFloat64(at, le), 8),
    u64: (/** @type {number} */ at) => {
      need(at, 8);
      const hi = view.getUint32(le ? at + 4 : at, le);
      const lo = view.getUint32(le ? at : at + 4, le);
      return hi * 2 ** 32 + lo;
    },
    view,
  };
}

/**
 * Inflate zlib ("deflate") or gzip data with the platform's DecompressionStream.
 * @param {Uint8Array} bytes
 * @param {"deflate" | "gzip" | "deflate-raw"} format
 */
export async function inflate(bytes, format) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The extension of a file name, lower case, without the dot ("" when it has none). */
export const extensionOf = (/** @type {string} */ name) => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
};

/** "1.2 MB", "37 bytes". */
export function sizeText(/** @type {number} */ bytes) {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
