// What curl wrote, as a response: stdout's header blocks (1xx, each redirect, a proxy's CONNECT,
// then the final one) and the body bytes after them; stderr's verbose lines as a timeline; and the
// JSON report after the marker as timings, sizes, addresses and TLS facts.

import { MARKER } from "./curl-config.js";

/**
 * @typedef {{ version: string, status: number, reason: string, headers: [string, string][] }} HeaderBlock
 * @typedef {{ kind: "info" | "out" | "in" | "data", text: string }} TimelineLine
 * @typedef {{ dns: number, tcp: number, tls: number, wait: number, download: number,
 *   redirect: number, total: number }} Timings
 */

const CRLF2 = [13, 10, 13, 10];

/** Where `needle` first occurs in `bytes` at or after `from`, or -1. @param {Uint8Array} bytes @param {number[]} needle */
function indexOf(bytes, needle, from = 0) {
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const latin1 = (/** @type {Uint8Array} */ bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

/** One header block as text: the status line then name: value lines. @param {string} text @returns {HeaderBlock | undefined} */
export function parseBlock(text) {
  const lines = text.split(/\r?\n/).filter((l) => l !== "");
  const first = /^(HTTP\/[\d.]+)\s+(\d{3})(?:\s+(.*))?$/.exec(lines[0] ?? "");
  if (!first) return undefined;
  /** @type {[string, string][]} */
  const headers = [];
  for (const line of lines.slice(1)) {
    if (/^\s/.test(line) && headers.length) {
      const last = /** @type {[string, string]} */ (headers[headers.length - 1]);
      last[1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return {
    version: first[1] ?? "",
    status: Number(first[2]),
    reason: first[3]?.trim() ?? "",
    headers,
  };
}

/**
 * Split stdout into the header blocks curl dumped and the body. A block is followed by another one
 * while it is informational (1xx), a proxy's CONNECT answer, or a redirect curl followed
 * (`redirects` of them); the first block after that is the response's, and the rest is the body.
 * @param {Uint8Array} bytes @param {{ redirects: number, head?: boolean }} info
 */
export function splitOutput(bytes, info) {
  /** @type {HeaderBlock[]} */
  const blocks = [];
  let at = 0;
  let redirects = info.redirects;
  for (;;) {
    const start = latin1(bytes.subarray(at, at + 5));
    if (start !== "HTTP/") break;
    const end = indexOf(bytes, CRLF2, at);
    const stop = end < 0 ? bytes.length : end + 4;
    const block = parseBlock(latin1(bytes.subarray(at, stop)));
    if (!block) break;
    blocks.push(block);
    at = stop;
    const connect = block.status === 200 && /connection established/i.test(block.reason);
    if (block.status < 200 || connect) continue;
    if (block.status >= 300 && block.status < 400 && redirects > 0) {
      redirects -= 1;
      continue;
    }
    if (!info.head) break;
  }
  return { blocks, body: bytes.subarray(at) };
}

/** stderr split at the marker: the verbose lines before it, the JSON report after it. @param {string} text */
export function splitErr(text) {
  const at = text.lastIndexOf(`\n${MARKER}\n`);
  const log = at >= 0 ? text.slice(0, at) : text;
  /** @type {Record<string, any> | undefined} */
  let report;
  if (at >= 0) {
    try {
      report = JSON.parse(text.slice(at + MARKER.length + 2));
    } catch {
      report = undefined;
    }
  }
  return { log, report };
}

/** curl's verbose lines as a timeline: `*` notes, `>` what was sent, `<` what came back. @param {string} log @returns {TimelineLine[]} */
export function timeline(log) {
  /** @type {TimelineLine[]} */
  const out = [];
  for (const raw of log.split(/\r?\n/)) {
    if (raw === "") continue;
    const mark = raw[0];
    const text = raw.slice(2);
    if (mark === "*") out.push({ kind: "info", text });
    else if (mark === ">") {
      if (text.trim() !== "") out.push({ kind: "out", text });
    } else if (mark === "<") {
      if (text.trim() !== "") out.push({ kind: "in", text });
    } else if (mark === "{" || mark === "}") out.push({ kind: "data", text: raw });
    else out.push({ kind: "info", text: raw });
  }
  return out;
}

/** The headers curl sent with the final request, from the timeline's last run of `>` lines. @param {TimelineLine[]} lines */
export function sentHeaders(lines) {
  /** @type {[string, string][]} */
  let current = [];
  /** @type {[string, string][]} */
  let last = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.kind === "out") {
      if (!inBlock) {
        current = [];
        inBlock = true;
        continue; // the request line
      }
      const colon = line.text.indexOf(":");
      if (colon > 0)
        current.push([line.text.slice(0, colon).trim(), line.text.slice(colon + 1).trim()]);
    } else if (inBlock) {
      last = current;
      inBlock = false;
    }
  }
  return inBlock ? current : last;
}

/** Seconds as curl reports them, to milliseconds. */
const ms = (/** @type {unknown} */ s) =>
  typeof s === "number" && Number.isFinite(s) ? s * 1000 : 0;

/**
 * The phases of the final request from curl's cumulative times: name lookup, TCP connect, TLS
 * handshake, waiting for the first byte, and the download; redirects before it on their own.
 * @param {Record<string, any> | undefined} report @returns {Timings}
 */
export function timings(report) {
  if (!report) return { dns: 0, tcp: 0, tls: 0, wait: 0, download: 0, redirect: 0, total: 0 };
  const redirect = ms(report.time_redirect);
  const dnsAt = ms(report.time_namelookup);
  const tcpAt = Math.max(dnsAt, ms(report.time_connect));
  const tlsAt = Math.max(tcpAt, ms(report.time_appconnect));
  const sentAt = Math.max(tlsAt, ms(report.time_pretransfer));
  const firstAt = Math.max(sentAt, ms(report.time_starttransfer));
  const total = Math.max(firstAt, ms(report.time_total));
  const base = Math.min(redirect, dnsAt);
  return {
    redirect,
    dns: Math.max(0, dnsAt - base),
    tcp: tcpAt - dnsAt,
    tls: ms(report.time_appconnect) > 0 ? tlsAt - tcpAt : 0,
    wait: firstAt - (ms(report.time_appconnect) > 0 ? tlsAt : tcpAt),
    download: total - firstAt,
    total,
  };
}

/** The parts of the TLS certificate curl reported that a person reads: subject, issuer, dates. @param {string | undefined} certs */
export function certificate(certs) {
  if (!certs) return undefined;
  const first = certs.split(/-----END CERTIFICATE-----/)[0] ?? "";
  const field = (/** @type {string} */ name) =>
    new RegExp(`^${name}:\\s*(.*)$`, "m").exec(first)?.[1]?.trim();
  const subject = field("Subject");
  if (!subject) return undefined;
  return {
    subject,
    issuer: field("Issuer") ?? "",
    start: field("Start date") ?? "",
    expire: field("Expire date") ?? "",
    names: (field("X509v3 Subject Alternative Name") ?? "")
      .split(",")
      .map((n) => n.trim().replace(/^DNS:/, ""))
      .filter(Boolean),
  };
}
