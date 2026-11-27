// Numbers and words for people: sizes, durations, times ago, and the reason phrase of a status
// (HTTP/2 and later send none, so the studio says it itself).

const REASONS = /** @type {Record<number, string>} */ ({
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  418: "I'm a teapot",
  422: "Unprocessable Content",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
});

/** The standard reason phrase of a status code, or "" for one without. @param {number} status */
export function reasonOf(status) {
  return REASONS[status] ?? "";
}

/** The class a status is coloured by: info, ok, redirect, client, server or none. @param {number} status */
export function statusClass(status) {
  if (!status) return "none";
  if (status < 200) return "info";
  if (status < 300) return "ok";
  if (status < 400) return "redirect";
  if (status < 500) return "client";
  return "server";
}

/** A size in bytes as B, KB, MB or GB (1000-based, as networks count). @param {number} bytes */
export function bytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    if (value < 1000) break;
    value /= 1000;
    unit = u;
  }
  return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

/** A duration in milliseconds as ms or s. @param {number} ms */
export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** How long ago a time was, in a few words. @param {number} at @param {number} [now] */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** A day heading for a history list: Today, Yesterday, or the date. @param {number} at @param {number} [now] */
export function dayOf(at, now = Date.now()) {
  const day = (/** @type {number} */ t) => new Date(t).toDateString();
  if (day(at) === day(now)) return "Today";
  if (day(at) === day(now - 86_400_000)) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** A clock time, hours and minutes (and seconds when asked). @param {number} at */
export function clock(at, seconds = false) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
}

/** The kind of a content type, for choosing a viewer: json, xml, html, image, text or binary. @param {string} type */
export function contentKind(type) {
  const t = type.toLowerCase();
  if (/[/+]json\b/.test(t) || t.includes("javascript")) return "json";
  if (t.includes("html")) return "html";
  if (/[/+]xml\b/.test(t)) return "xml";
  if (t.startsWith("image/")) return "image";
  if (
    t.startsWith("text/") ||
    t.includes("csv") ||
    t.includes("yaml") ||
    t.includes("x-www-form-urlencoded")
  )
    return "text";
  if (t === "") return "unknown";
  return "binary";
}
