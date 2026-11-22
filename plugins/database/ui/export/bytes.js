// An export's text as the bytes of the encoding chosen (PG-61), with a byte order mark when asked,
// and how fs.write takes them: plain UTF-8 as text, anything else as base64. No DOM.

import { base64Of } from "./text.js";

/**
 * @typedef {import("./options.js").Encoding} Encoding
 * @typedef {{ content: string, encoding: "utf8" | "base64", bytes: number }} FileContent
 */

/**
 * @param {string} text
 * @param {{ encoding: Encoding, bom: boolean }} options
 * @returns {FileContent}
 */
export function encodeText(text, { encoding, bom }) {
  if (encoding === "utf-8" && !bom)
    return { content: text, encoding: "utf8", bytes: new TextEncoder().encode(text).length };
  return contentOf(bytesOf(text, encoding, bom));
}

/** Bytes as fs.write takes them. @returns {FileContent} */
export const contentOf = (/** @type {Uint8Array} */ bytes) => ({
  content: base64Of(bytes),
  encoding: "base64",
  bytes: bytes.length,
});

/** The text's bytes in an encoding, the mark first when asked. */
export function bytesOf(
  /** @type {string} */ text,
  /** @type {Encoding} */ encoding,
  /** @type {boolean} */ bom,
) {
  if (encoding === "utf-8") {
    const body = new TextEncoder().encode(text);
    if (!bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const little = encoding === "utf-16le";
  const start = bom ? 2 : 0;
  const out = new Uint8Array(start + text.length * 2);
  const view = new DataView(out.buffer);
  if (bom) view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < text.length; i++) view.setUint16(start + i * 2, text.charCodeAt(i), little);
  return out;
}
