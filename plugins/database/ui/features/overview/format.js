// How the overview panel writes a figure: bytes in KiB, MiB and GiB, counts with grouping, seconds
// as minutes, hours and days, times to the minute, and none as a dash. The SQL keeps the raw
// numbers, so a section opened as a result copies and exports them. No DOM.

import { formatCount } from "../../format.js";

/** @typedef {import("./sql.js").Format} Format */

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
export const NONE = "–";

/** A size in bytes. */
export function formatBytes(/** @type {number} */ bytes) {
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const sign = bytes < 0 ? "-" : "";
  return unit === 0
    ? `${sign}${value} B`
    : `${sign}${value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

/** A span of seconds: under a minute in seconds, then minutes, hours and days. */
export function formatSeconds(/** @type {number} */ seconds) {
  const s = Math.round(seconds);
  if (Math.abs(seconds) < 60) return `${Math.round(seconds * 10) / 10} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  const days = Math.floor(s / 86400);
  return `${days} day${days === 1 ? "" : "s"} ${Math.floor((s % 86400) / 3600)} h`;
}

/** Milliseconds as ms, s or min. */
export function formatMs(/** @type {number} */ ms) {
  if (ms < 1) return `${ms} ms`;
  if (ms < 1000) return `${Math.round(ms * 10) / 10} ms`;
  return formatSeconds(ms / 1000);
}

/**
 * One value as the panel shows it.
 * @param {Format | undefined} format
 * @param {string | null | undefined} value
 */
export function formatValue(format, value) {
  if (value === null || value === undefined || value === "") return NONE;
  const n = Number(value);
  const numeric = Number.isFinite(n);
  switch (format) {
    case "bytes":
      return numeric ? formatBytes(n) : value;
    case "count":
      return numeric ? formatCount(n) : value;
    case "estimate":
      return numeric && n < 0 ? "not analyzed" : numeric ? formatCount(n) : value;
    case "percent":
      return numeric ? `${n}%` : value;
    case "seconds":
      return numeric ? formatSeconds(n) : value;
    case "ms":
      return numeric ? formatMs(n) : value;
    case "time":
      return value.replace("T", " ").slice(0, 16);
    case "bool":
      return ["t", "true", "on", "yes"].includes(value) ? "yes" : "no";
    case "query":
      return value.replace(/\s+/gu, " ").trim();
    default:
      return value;
  }
}

/** Whether a column holds numbers, set flush right. */
export const numeric = (/** @type {Format | undefined} */ format) =>
  format === "bytes" ||
  format === "count" ||
  format === "estimate" ||
  format === "percent" ||
  format === "seconds" ||
  format === "ms";

/** How long the server has run, for the panel's header. */
export const uptime = (/** @type {number | null} */ seconds) =>
  seconds === null ? "" : `up ${formatSeconds(seconds)}`;
