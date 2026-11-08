// MIME as MHTML uses it (RFC 2557): headers with folded lines, multipart/related bodies split on
// their boundary, and quoted-printable and base64 parts.
import { bytesOf, fromBase64, latin1 } from "./bytes.js";

/** @typedef {{ headers: Map<string, string>, body: Uint8Array }} Part */

/**
 * Split a byte-per-character message into its headers (names in lower case) and the offset where
 * its body starts.
 * @param {string} text
 * @param {number} [from]
 */
export function headersOf(text, from = 0) {
  const blank = /\r?\n\r?\n/g;
  blank.lastIndex = from;
  const found = blank.exec(text);
  const end = found ? found.index : text.length;
  const bodyAt = found ? found.index + found[0].length : text.length;
  /** @type {Map<string, string>} */
  const headers = new Map();
  const unfolded = text.slice(from, end).replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return { headers, bodyAt };
}

/** A parameter of a header value: `boundary` of `multipart/related; boundary="x"`. */
export function parameter(/** @type {string | undefined} */ value, /** @type {string} */ name) {
  if (!value) return undefined;
  const found = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  return found ? (found[1] ?? found[2]) : undefined;
}

/** The type of a Content-Type value, in lower case, without parameters. */
export const typeOf = (/** @type {string | undefined} */ value) =>
  (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

/** @param {string} text */
function quotedPrintable(text) {
  const raw = text.replace(/=\r?\n/g, "");
  const out = new Uint8Array(raw.length);
  let size = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x3d && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      out[size++] = Number.parseInt(raw.slice(i + 1, i + 3), 16);
      i += 2;
    } else out[size++] = c & 0xff;
  }
  return out.subarray(0, size);
}

/** A part's body decoded from its Content-Transfer-Encoding. */
export function decodeBody(/** @type {string} */ text, /** @type {string | undefined} */ encoding) {
  const name = (encoding ?? "").trim().toLowerCase();
  if (name === "base64") return fromBase64(text);
  if (name === "quoted-printable") return quotedPrintable(text);
  return bytesOf(text);
}

/**
 * The parts of a multipart MIME message.
 * @param {Uint8Array} bytes
 * @returns {{ headers: Map<string, string>, parts: Part[] }}
 */
export function readMultipart(bytes) {
  const text = latin1(bytes);
  const { headers, bodyAt } = headersOf(text);
  const type = headers.get("content-type");
  const boundary = parameter(type, "boundary");
  if (!typeOf(type).startsWith("multipart/") || !boundary)
    throw new Error("The archive is not a multipart MIME message.");
  const delimiter = `--${boundary}`;
  /** @type {Part[]} */
  const parts = [];
  let at = text.indexOf(delimiter, bodyAt);
  while (at >= 0) {
    let lineEnd = text.indexOf("\n", at);
    if (lineEnd < 0) break;
    if (text.startsWith("--", at + delimiter.length)) break;
    lineEnd += 1;
    let next = text.indexOf(`\n${delimiter}`, lineEnd);
    if (next < 0) next = text.length;
    const partEnd = text[next - 1] === "\r" ? next - 1 : next;
    const part = headersOf(text, lineEnd);
    const body = text.slice(Math.min(part.bodyAt, partEnd), partEnd);
    parts.push({
      headers: part.headers,
      body: decodeBody(body, part.headers.get("content-transfer-encoding")),
    });
    at = next < text.length ? next + 1 : -1;
  }
  if (parts.length === 0) throw new Error("The archive holds no parts.");
  return { headers, parts };
}

/** A date as an ISO string (RFC 822 and ISO 8601 alike), or undefined when it is not one. */
export function isoDate(/** @type {string | undefined} */ text) {
  if (!text?.trim()) return undefined;
  const date = new Date(text.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
