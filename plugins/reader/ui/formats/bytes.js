// Byte helpers every reader shares: base64 both ways, data: URLs, text decoding, big-endian reads,
// the media type of a file name and the natural order of names ("2.jpg" before "10.jpg").

/** @param {string} text */
export function fromBase64(text) {
  const native = /** @type {{ fromBase64?: (s: string) => Uint8Array }} */ (Uint8Array).fromBase64;
  if (native) return native(text);
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  const native = /** @type {{ toBase64?: () => string }} */ (/** @type {unknown} */ (bytes))
    .toBase64;
  if (native) return native.call(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** @param {string} mime @param {Uint8Array} bytes */
export const dataUrl = (mime, bytes) => `data:${mime};base64,${toBase64(bytes)}`;

/** @param {Uint8Array} bytes @param {string} [encoding] */
export function decode(bytes, encoding = "utf-8") {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** @param {Uint8Array} bytes @param {number} at */
export const u16 = (bytes, at) => (((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)) >>> 0;
/** @param {Uint8Array} bytes @param {number} at */
export const u32 = (bytes, at) => ((u16(bytes, at) << 16) | u16(bytes, at + 2)) >>> 0;
/** @param {Uint8Array} bytes @param {number} at */
export const u16le = (bytes, at) => ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)) >>> 0;
/** @param {Uint8Array} bytes @param {number} at */
export const u32le = (bytes, at) => (u16le(bytes, at) | (u16le(bytes, at + 2) << 16)) >>> 0;

/** The ASCII characters at `at`, as many as `length`. */
export function ascii(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ at,
  /** @type {number} */ length,
) {
  let out = "";
  for (let i = at; i < Math.min(bytes.length, at + length); i++)
    out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/** Where `needle` (ASCII) first occurs in `bytes` from `from`, or -1. */
export function indexOf(/** @type {Uint8Array} */ bytes, /** @type {string} */ needle, from = 0) {
  const first = needle.charCodeAt(0);
  outer: for (let i = bytes.indexOf(first, from); i >= 0; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++)
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

const MIME = /** @type {Record<string, string>} */ ({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  jxl: "image/jxl",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  css: "text/css",
  xhtml: "application/xhtml+xml",
  html: "text/html",
  htm: "text/html",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
});

/** @param {string} name */
export const extensionOf = (name) => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
};

/** @param {string} name */
export const mimeOf = (name) => MIME[extensionOf(name)] ?? "application/octet-stream";

/** Whether a file name is an image a page can show. */
export const isImage = (/** @type {string} */ name) => mimeOf(name).startsWith("image/");

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural order: digits compare as numbers, case does not matter. */
export const naturalCompare = (/** @type {string} */ a, /** @type {string} */ b) =>
  collator.compare(a, b);

/** A size in words: "812 bytes", "1.4 MB". */
export function sizeInWords(/** @type {number} */ bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
