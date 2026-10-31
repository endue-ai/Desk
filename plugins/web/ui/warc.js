// WARC 1.0 and 1.1 (ISO 28500): every record listed; response and resource records are the
// archive's resources by target URI, and an HTML response is drawn with them. A .warc.gz is a
// gzip member per record, decoded as one stream.

import { archiveResolver, pageOf, urlKey } from "./archive.js";
import { charsetOf, decodeText, latin1, startsWith } from "./bytes.js";
import { gunzip, inflateZlib } from "./inflate.js";
import { headersOf, isoDate, typeOf } from "./mime.js";

/**
 * @typedef {import("./formats.js").Entry} Entry
 * @typedef {import("./archive.js").Stored} Stored
 * @typedef {{ warc: Map<string, string>, head: string, block: Uint8Array }} WarcRecord
 */

const SHOWN_TEXT = 64 * 1024;

/** @param {Uint8Array} bytes */
export function readRecords(bytes) {
  /** @type {WarcRecord[]} */
  const records = [];
  let at = 0;
  while (at < bytes.length) {
    while (at < bytes.length && (bytes[at] === 0x0d || bytes[at] === 0x0a)) at++;
    if (at >= bytes.length) break;
    if (!startsWith(bytes, "WARC/", at))
      throw new Error("A WARC record does not start where it should.");
    let end = at;
    while (
      end + 3 < bytes.length &&
      !(
        bytes[end] === 0x0d &&
        bytes[end + 1] === 0x0a &&
        bytes[end + 2] === 0x0d &&
        bytes[end + 3] === 0x0a
      )
    )
      end++;
    const head = latin1(bytes, at, Math.min(end + 4, bytes.length));
    const { headers } = headersOf(head.slice(head.indexOf("\n") + 1));
    const length = Number(headers.get("content-length"));
    const start = end + 4;
    if (!Number.isFinite(length) || start + length > bytes.length)
      throw new Error("A WARC record is cut short.");
    records.push({ warc: headers, head, block: bytes.subarray(start, start + length) });
    at = start + length;
  }
  return records;
}

/** The body of a chunked HTTP message. */
function dechunk(/** @type {Uint8Array} */ body) {
  /** @type {Uint8Array[]} */
  const parts = [];
  let at = 0;
  for (;;) {
    let line = at;
    while (line < body.length && body[line] !== 0x0a) line++;
    const size = Number.parseInt(latin1(body, at, line), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    parts.push(body.subarray(line + 1, line + 1 + size));
    at = line + 1 + size + 2;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** An HTTP response block: its head as text, its headers, and its body decoded for transport. */
function httpOf(/** @type {Uint8Array} */ block) {
  const text = latin1(block, 0, Math.min(block.length, 64 * 1024));
  const { headers, bodyAt } = headersOf(text.slice(text.indexOf("\n") + 1));
  const headAt = text.indexOf("\n") + 1 + bodyAt;
  let body = block.subarray(Math.min(headAt, block.length));
  const status = Number(/^HTTP\/[\d.]+\s+(\d{3})/.exec(text)?.[1] ?? 0);
  if (/chunked/i.test(headers.get("transfer-encoding") ?? "")) body = dechunk(body);
  const coding = (headers.get("content-encoding") ?? "").trim().toLowerCase();
  /** @type {Uint8Array | undefined} */
  let payload = body;
  try {
    if (coding === "gzip" || coding === "x-gzip") payload = gunzip(body);
    else if (coding === "deflate") payload = inflateZlib(body);
    else if (coding && coding !== "identity") payload = undefined;
  } catch {
    payload = undefined;
  }
  return { head: text.slice(0, headAt), headers, status, payload };
}

/**
 * @param {Uint8Array} bytes
 * @param {boolean} compressed
 * @returns {{ entries: Entry[], selected: number }}
 */
export function openWarc(bytes, compressed) {
  const records = readRecords(compressed ? gunzip(bytes) : bytes);
  if (records.length === 0) throw new Error("The WARC file holds no records.");
  /** @type {Map<string, Stored>} */
  const stored = new Map();
  const read = records.map((record) => {
    const type = (record.warc.get("warc-type") ?? "").toLowerCase();
    const uri = (record.warc.get("warc-target-uri") ?? "").replace(/^<(.*)>$/, "$1");
    const declared = record.warc.get("content-type") ?? "";
    const response = type === "response" || /msgtype=response/i.test(declared);
    const http =
      response && /^application\/http/i.test(declared) ? httpOf(record.block) : undefined;
    const payloadType = http ? (http.headers.get("content-type") ?? "") : declared;
    const payload = http ? http.payload : record.block;
    const key = uri ? urlKey(uri) : undefined;
    const usable =
      (type === "response" && (!http || (http.status >= 200 && http.status < 300))) ||
      type === "resource";
    if (key && payload && usable && !stored.has(key))
      stored.set(key, { bytes: payload, type: payloadType });
    return { record, type, uri, key, http, payloadType, payload, usable };
  });
  const entries = read.map(({ record, type, uri, key, http, payloadType, payload, usable }) => {
    const kind = typeOf(payloadType);
    /** @type {Entry} */
    const entry = {
      title: uri || type || "record",
      detail: [type, kind].filter(Boolean).join(" · "),
      date: isoDate(record.warc.get("warc-date")),
    };
    if (usable && key && payload && /^(text\/html|application\/xhtml\+xml)$/.test(kind)) {
      entry.page = pageOf(
        payload,
        payloadType,
        key,
        archiveResolver(key, stored),
        charsetOf(payloadType),
      );
      entry.source = entry.page.text;
      return entry;
    }
    let text = record.head.replace(/\r\n/g, "\n");
    if (http) text += http.head.replace(/\r\n/g, "\n");
    const body = http ? payload : record.block;
    if (
      body &&
      (/^(text\/|application\/(json|javascript|xml|warc-fields))/.test(kind) ||
        (!http && type !== "response" && type !== "resource"))
    )
      text += `\n${decodeText(body.subarray(0, SHOWN_TEXT), { declared: charsetOf(payloadType), sniff: false }).text}`;
    else if (body) text += `\n${body.length} bytes of ${kind || "data"}.`;
    else text += "\nThe body uses a content encoding Web does not read.";
    entry.text = text;
    return entry;
  });
  const html = entries.findIndex((entry) => entry.page);
  return { entries, selected: Math.max(0, html) };
}
