import { number } from "./strings/index.js";

/** Format a count in the desk's language (ui/strings/, PG-108). */
export function formatCount(/** @type {number} */ count) {
  return number(count);
}

/** Format milliseconds as milliseconds, seconds, or minutes and seconds. */
export function formatDuration(/** @type {number} */ ms) {
  if (ms <= 1000) return `${formatCount(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${formatCount(Math.floor(seconds / 60))} min ${seconds % 60} s`;
}

/** Format a size in bytes in binary units: "640 B", "48 KiB", "1.5 GiB". */
export function formatBytes(/** @type {number} */ bytes) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  for (; value >= 1024 && unit < units.length - 1; unit++) value /= 1024;
  const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${number(shown)} ${units[unit]}`;
}
