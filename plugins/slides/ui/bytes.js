// Bytes: base64 both ways, little-endian reads, text decoders and data: URLs. No DOM.

/** @param {string} text @returns {Uint8Array} */
export function fromBase64(text) {
  const native = /** @type {{ fromBase64?: (s: string) => Uint8Array }} */ (
    /** @type {unknown} */ (Uint8Array)
  ).fromBase64;
  if (native) return native(text.replace(/\s+/g, ""));
  const binary = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes @returns {string} */
export function toBase64(bytes) {
  const native = /** @type {{ toBase64?: () => string }} */ (/** @type {unknown} */ (bytes))
    .toBase64;
  if (native) return native.call(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** @param {Uint8Array} bytes */
export const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** @param {Uint8Array} bytes @param {number} at */
export const u16 = (bytes, at) => (at + 2 <= bytes.length ? view(bytes).getUint16(at, true) : 0);
/** @param {Uint8Array} bytes @param {number} at */
export const u32 = (bytes, at) => (at + 4 <= bytes.length ? view(bytes).getUint32(at, true) : 0);
/** @param {Uint8Array} bytes @param {number} at */
export const i32 = (bytes, at) => (at + 4 <= bytes.length ? view(bytes).getInt32(at, true) : 0);
/** @param {Uint8Array} bytes @param {number} at */
export const i16 = (bytes, at) => (at + 2 <= bytes.length ? view(bytes).getInt16(at, true) : 0);

/** @param {Uint8Array} bytes */
export const utf8 = (bytes) => new TextDecoder("utf-8").decode(bytes);
/** @param {Uint8Array} bytes */
export const utf16le = (bytes) => new TextDecoder("utf-16le").decode(bytes);
/** @param {Uint8Array} bytes */
export const latin1 = (bytes) => new TextDecoder("windows-1252").decode(bytes);

/** Whether `bytes` starts with `prefix` at `at`. @param {Uint8Array} bytes @param {number[]} prefix */
export const startsWith = (bytes, prefix, at = 0) => prefix.every((b, i) => bytes[at + i] === b);

/** The image type of some bytes, or "" when the webview cannot draw it. @param {Uint8Array} b */
export function imageType(b) {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(b, [0x42, 0x4d])) return "image/bmp";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(b, [0x49, 0x49, 0x2a, 0]) || startsWith(b, [0x4d, 0x4d, 0, 0x2a]))
    return "image/tiff";
  const head = utf8(b.subarray(0, 256)).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")))
    return "image/svg+xml";
  return "";
}

/** A data: URL of image bytes, or null when the webview cannot draw them. @param {Uint8Array} b */
export function imageUrl(b) {
  const type = imageType(b);
  return type ? `data:${type};base64,${toBase64(b)}` : null;
}

/** A size in words: 512 bytes, 1.2 KB, 3.4 MB. @param {number} n */
export function sizeText(n) {
  if (n < 1024) return `${n} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]} (${n} bytes)`;
}
