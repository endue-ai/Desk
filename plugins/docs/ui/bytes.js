// Bytes: base64 both ways, little-endian reads, text in a named encoding, deflate through the
// platform's DecompressionStream, and pictures as data: URLs (the frame's CSP allows only those).

/** @param {string} base64 */
export function fromBase64(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A view for little-endian reads that never throws past the end: missing bytes read as 0. */
export class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** @param {number} at */
  u8(at) {
    return at >= 0 && at < this.bytes.length ? (this.bytes[at] ?? 0) : 0;
  }
  /** @param {number} at */
  u16(at) {
    return at >= 0 && at + 2 <= this.bytes.length ? this.view.getUint16(at, true) : 0;
  }
  /** @param {number} at */
  i16(at) {
    return at >= 0 && at + 2 <= this.bytes.length ? this.view.getInt16(at, true) : 0;
  }
  /** @param {number} at */
  u32(at) {
    return at >= 0 && at + 4 <= this.bytes.length ? this.view.getUint32(at, true) : 0;
  }
  /** @param {number} at */
  i32(at) {
    return at >= 0 && at + 4 <= this.bytes.length ? this.view.getInt32(at, true) : 0;
  }
}

/** @param {Uint8Array} bytes @param {number} at @param {number[]} expected */
export const startsWith = (bytes, expected, at = 0) =>
  expected.every((b, i) => bytes[at + i] === b);

/** @param {Uint8Array} bytes @param {string} ascii @param {number} [at] */
export const startsWithText = (bytes, ascii, at = 0) =>
  startsWith(
    bytes,
    [...ascii].map((c) => c.charCodeAt(0)),
    at,
  );

/**
 * Text in `encoding` (a WHATWG label: utf-8, utf-16le, windows-1252, euc-kr, shift_jis...).
 * Unknown labels fall back to windows-1252 so a document still opens.
 * @param {Uint8Array} bytes
 * @param {string} [encoding]
 */
export function decode(bytes, encoding = "utf-8") {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** UTF-8, UTF-16 or Latin text by its byte order mark, for files that may carry one. */
export function decodeText(/** @type {Uint8Array} */ bytes) {
  if (startsWith(bytes, [0xff, 0xfe])) return decode(bytes.subarray(2), "utf-16le");
  if (startsWith(bytes, [0xfe, 0xff])) return decode(bytes.subarray(2), "utf-16be");
  return decode(bytes, "utf-8");
}

/**
 * Inflate with the platform's DecompressionStream: "deflate-raw" (ZIP, HWP), "deflate" (zlib)
 * or "gzip". Bytes after the end of the compressed data (HWP pads its streams) are ignored; a
 * stream that gives nothing rejects, and nothing is left unhandled.
 * @param {Uint8Array} bytes
 * @param {CompressionFormat} [format]
 * @returns {Promise<Uint8Array>}
 */
export async function inflate(bytes, format = "deflate-raw") {
  const stream = new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  // Fed in slices, so the output before any trailing junk is read before the stream fails.
  const feed = async () => {
    for (let at = 0; at < bytes.length; at += 0x10000)
      await writer.write(/** @type {Uint8Array<ArrayBuffer>} */ (bytes.slice(at, at + 0x10000)));
    await writer.close();
  };
  feed().catch(() => {});
  const reader = stream.readable.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
  } catch (error) {
    if (size === 0) throw error;
  }
  return concat(parts, size);
}

/** @param {Uint8Array[]} parts @param {number} [size] */
export function concat(parts, size = parts.reduce((n, p) => n + p.length, 0)) {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The picture formats the page view shows, by their first bytes. */
const PICTURES = /** @type {const} */ ([
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["image/bmp", [0x42, 0x4d]],
  ["image/tiff", [0x49, 0x49, 0x2a, 0x00]],
  ["image/tiff", [0x4d, 0x4d, 0x00, 0x2a]],
]);

/** @param {Uint8Array} bytes @returns {string | undefined} */
export function pictureType(bytes) {
  for (const [type, magic] of PICTURES) if (startsWith(bytes, [...magic])) return type;
  if (startsWithText(bytes, "RIFF") && startsWithText(bytes, "WEBP", 8)) return "image/webp";
  return undefined;
}

/** A picture's name for the alt text when it cannot be shown: EMF, WMF, SVG... */
export function pictureKind(/** @type {Uint8Array} */ bytes, /** @type {string} */ name = "") {
  if (startsWith(bytes, [0x01, 0x00, 0x00, 0x00]) && startsWithText(bytes, " EMF", 40))
    return "EMF";
  if (startsWith(bytes, [0xd7, 0xcd, 0xc6, 0x9a]) || startsWith(bytes, [0x01, 0x00, 0x09, 0x00]))
    return "WMF";
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase() : "unknown";
}

/**
 * A data: URL for a picture the page view can show, or null.
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
export function pictureUrl(bytes) {
  const type = pictureType(bytes);
  return type ? `data:${type};base64,${toBase64(bytes)}` : null;
}

/** Hex digits to bytes, skipping whitespace and anything else. */
export function fromHex(/** @type {string} */ hex) {
  const digits = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(digits.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return out;
}
