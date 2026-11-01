// Bytes and text: base64 both ways, a byte-per-character view for headers, text decoding by the
// BOM, a declared or <meta> charset, UTF-8 and then EUC-KR, and the image types a data: URL may carry.

const CHUNK = 0x8000;

/** @param {string} text base64, whitespace allowed */
export function fromBase64(text) {
  const binary = atob(text.replace(/[^A-Za-z0-9+/=]/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK * 3) {
    const part = bytes.subarray(i, i + CHUNK * 3);
    let binary = "";
    for (let j = 0; j < part.length; j += CHUNK)
      binary += String.fromCharCode.apply(null, /** @type {any} */ (part.subarray(j, j + CHUNK)));
    out += btoa(binary);
  }
  return out;
}

/** One character per byte (ISO-8859-1 exactly, unlike TextDecoder's "latin1"). */
export function latin1(/** @type {Uint8Array} */ bytes, start = 0, end = bytes.length) {
  let out = "";
  for (let i = start; i < end; i += CHUNK)
    out += String.fromCharCode.apply(
      null,
      /** @type {any} */ (bytes.subarray(i, Math.min(end, i + CHUNK))),
    );
  return out;
}

/** The bytes of a byte-per-character string. */
export function bytesOf(/** @type {string} */ binary) {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/** @param {Uint8Array} bytes @param {number} at @param {string} text */
export const startsWith = (bytes, text, at = 0) => {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** The encoding a BOM names, and its length. */
function bom(/** @type {Uint8Array} */ bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return ["utf-8", 3];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return ["utf-16le", 2];
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return ["utf-16be", 2];
  return null;
}

/** A label TextDecoder knows, or null. UTF-16 named inside an ASCII document means UTF-8. */
function known(/** @type {string | undefined} */ label) {
  if (!label) return null;
  try {
    const { encoding } = new TextDecoder(label.trim().toLowerCase());
    return encoding.startsWith("utf-16") ? "utf-8" : encoding;
  } catch {
    return null;
  }
}

/** The charset of `<meta charset>`, `<meta http-equiv content-type>` or `<?xml encoding?>`. */
export function sniffCharset(/** @type {Uint8Array} */ bytes) {
  const head = latin1(bytes, 0, Math.min(bytes.length, 4096));
  const xml = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)/i.exec(head);
  if (xml) return xml[1];
  // <meta charset="x"> and <meta http-equiv="Content-Type" content="text/html; charset=x"> alike.
  for (const meta of head.matchAll(/<meta\b[^>]*>/gi)) {
    const charset = /\bcharset\s*=\s*["']?([^"'\s/>;]+)/i.exec(meta[0]);
    if (charset) return charset[1];
  }
  return undefined;
}

/** The charset parameter of a Content-Type value. */
export const charsetOf = (/** @type {string | undefined} */ type) =>
  type ? /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(type)?.[1] : undefined;

/**
 * Decode text as a browser would: the BOM, then the declared charset (an HTTP header, an archive's
 * field), then the document's own `<meta>` or XML declaration, otherwise UTF-8, and EUC-KR when the
 * bytes are not UTF-8.
 * @param {Uint8Array} bytes
 * @param {{ declared?: string, sniff?: boolean }} [options]
 * @returns {{ text: string, encoding: string }}
 */
export function decodeText(bytes, { declared, sniff = true } = {}) {
  const marked = bom(bytes);
  if (marked) {
    const [encoding, length] = marked;
    return { text: new TextDecoder(encoding).decode(bytes.subarray(length)), encoding };
  }
  const named = known(declared) ?? (sniff ? known(sniffCharset(bytes)) : null);
  if (named && named !== "utf-8")
    return { text: new TextDecoder(named).decode(bytes), encoding: named };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    if (named === "utf-8")
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}

const IMAGE_TYPES = /** @type {Record<string, string>} */ ({
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  cur: "image/x-icon",
  svg: "image/svg+xml",
});

/**
 * The image type of some bytes, from their first bytes, else a declared image type, else the
 * name's extension; undefined when they are not an image a page may show.
 * @param {Uint8Array} bytes @param {string} [declared] @param {string} [name]
 */
export function imageType(bytes, declared, name) {
  if (startsWith(bytes, "\x89PNG")) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (startsWith(bytes, "GIF8")) return "image/gif";
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8)) return "image/webp";
  if (startsWith(bytes, "ftypavi", 4)) return "image/avif";
  if (startsWith(bytes, "BM")) return "image/bmp";
  if (startsWith(bytes, "\0\0\x01\0")) return "image/x-icon";
  const head = latin1(bytes, 0, Math.min(bytes.length, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    return "image/svg+xml";
  const type = declared?.split(";")[0]?.trim().toLowerCase();
  if (type?.startsWith("image/") && Object.values(IMAGE_TYPES).includes(type)) return type;
  const ext = name ? /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name)?.[1]?.toLowerCase() : undefined;
  return ext ? IMAGE_TYPES[ext] : undefined;
}

/** A data: URL a page may show as an image: data:image/<a known type>. */
export const isImageData = (/** @type {string} */ url) =>
  /^data:image\/(png|apng|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/i.test(
    url,
  );

/** @param {string} type @param {Uint8Array} bytes */
export const dataUrl = (type, bytes) => `data:${type};base64,${toBase64(bytes)}`;
