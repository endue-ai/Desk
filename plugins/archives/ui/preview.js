// What the preview shows for an entry's first bytes: text (UTF-8, EUC-KR when it is not UTF-8) up to
// 1 MiB, images the webview shows as data: URLs (SVG only as an image), an archive to open one level
// down, or the first 4 KiB as hex. Nothing is ever run. No DOM.
import { at, formatBytes, formatSize, toBase64 } from "./bytes.js";

/**
 * @typedef {{ kind: "text", name: string, text: string, encoding: string, caption: string }
 *   | { kind: "image", name: string, url: string, caption: string }
 *   | { kind: "hex", name: string, hex: string, caption: string }
 *   | { kind: "archive", name: string, format: string, caption: string }
 *   | { kind: "folder", name: string, caption: string }
 *   | { kind: "message", name: string, text: string }} PreviewModel
 */

export const TEXT_LIMIT = 1024 * 1024;
export const HEX_LIMIT = 4096;
/** Images larger than this are shown as hex: a data: URL holds the whole file. */
export const IMAGE_LIMIT = 32 * 1024 * 1024;

/** The image type of `head`, by its magic (or an SVG's text), or "". @param {Uint8Array} head @param {string} name */
export function imageType(head, name) {
  if (at(head, 0, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (at(head, 0, "GIF87a") || at(head, 0, "GIF89a")) return "image/gif";
  if (at(head, 0, "RIFF") && at(head, 8, "WEBP")) return "image/webp";
  if (
    /\.svgz?$/i.test(name) ||
    /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(
      new TextDecoder().decode(head.subarray(0, 512)),
    )
  )
    return /\.svgz$/i.test(name) ? "" : "image/svg+xml";
  return "";
}

/**
 * The text in `bytes`, or undefined when they are not text: NUL bytes, or neither valid UTF-8 nor
 * valid EUC-KR. A multi-byte character cut off by the read limit is dropped.
 * @param {Uint8Array} bytes @param {boolean} cut whether the bytes stop before the entry ends
 */
export function asText(bytes, cut) {
  if (bytes.subarray(0, HEX_LIMIT).includes(0)) return undefined;
  for (const encoding of ["utf-8", "euc-kr"]) {
    for (let drop = 0; drop <= (cut ? 3 : 0); drop++) {
      try {
        const text = new TextDecoder(encoding, { fatal: true }).decode(
          bytes.subarray(0, bytes.length - drop),
        );
        return { text, encoding: encoding === "utf-8" ? "UTF-8" : "EUC-KR" };
      } catch {}
    }
  }
  return undefined;
}

/** "00000000  48 65 6c 6c 6f 2c 20 61  72 63 68 69 76 65 73 21  |Hello, archives!|" @param {Uint8Array} bytes */
export function hexDump(bytes) {
  const lines = [];
  for (let o = 0; o < bytes.length; o += 16) {
    const line = bytes.subarray(o, o + 16);
    let hex = "";
    let ascii = "";
    for (let i = 0; i < 16; i++) {
      const b = line[i];
      hex += (b === undefined ? "  " : b.toString(16).padStart(2, "0")) + (i === 7 ? "  " : " ");
      if (b !== undefined) ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
    }
    lines.push(`${o.toString(16).padStart(8, "0")}  ${hex} |${ascii}|`);
  }
  return lines.join("\n");
}

/** "4.9 KiB (5,000 bytes)" @param {number} size */
const sized = (size) =>
  size < 0
    ? "Size unknown"
    : size < 1024
      ? formatBytes(size)
      : `${formatSize(size)} (${formatBytes(size)})`;

/**
 * @param {string} name the entry's file name
 * @param {number} size the entry's size (-1 when unknown)
 * @param {Uint8Array} bytes its first bytes (all of them when it is small)
 * @param {string} [archive] the format, when the bytes are an archive this plugin opens
 * @returns {PreviewModel}
 */
export function previewOf(name, size, bytes, archive) {
  const whole = size >= 0 ? bytes.length >= size : bytes.length < TEXT_LIMIT;
  if (archive)
    return {
      kind: "archive",
      name,
      format: archive,
      caption: `${archive}, ${sized(size)}. Open it to see what it holds.`,
    };
  const type = imageType(bytes, name);
  if (type && whole && bytes.length <= IMAGE_LIMIT)
    return {
      kind: "image",
      name,
      url: `data:${type};base64,${toBase64(bytes)}`,
      caption: `${type.slice(6).toUpperCase().replace("SVG+XML", "SVG")} image, ${sized(size)}`,
    };
  const text = asText(bytes, !whole);
  if (text) {
    const shown = whole
      ? sized(size)
      : `the first ${formatSize(bytes.length)} of ${sized(size).replace("Size unknown", "more")}`;
    return {
      kind: "text",
      name,
      text: text.text,
      encoding: text.encoding,
      caption: `${text.encoding} text, ${shown}`,
    };
  }
  const part = bytes.subarray(0, HEX_LIMIT);
  const shown =
    part.length < bytes.length || !whole ? `; the first ${formatSize(part.length)} as hex` : "";
  return { kind: "hex", name, hex: hexDump(part), caption: `${sized(size)}${shown}` };
}
