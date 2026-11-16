// Numbers and times as people read them: sizes (docker's own "1.2GB" and "30MiB" read back into
// bytes), percentages, "3 minutes ago", "2h 4m", short ids. Pure.

const UNITS = /** @type {Record<string, number>} */ ({
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  pib: 1024 ** 5,
});

/** "1.2GB", "30MiB", "512B", "0B", "1.5 kB" → bytes; NaN when it is not a size. */
export function parseSize(/** @type {unknown} */ text) {
  if (typeof text === "number") return text;
  if (typeof text !== "string") return Number.NaN;
  const match = /^\s*([\d.]+)\s*([kKmMgGtTpP]?i?[bB])?\s*$/.exec(text);
  if (!match) return Number.NaN;
  const unit = UNITS[(match[2] ?? "b").toLowerCase()] ?? 1;
  return Number(match[1]) * unit;
}

/** "12.5%" → 12.5; NaN otherwise. */
export function parsePercent(/** @type {unknown} */ text) {
  if (typeof text !== "string") return Number.NaN;
  const match = /^\s*(-?[\d.]+)\s*%\s*$/.exec(text);
  return match ? Number(match[1]) : Number.NaN;
}

/** Bytes in decimal units, as docker writes image sizes: 431 MB, 1.2 GB. */
export function bytes(/** @type {number} */ n, digits = 1) {
  if (!Number.isFinite(n)) return "–";
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ["kB", "MB", "GB", "TB", "PB"];
  let value = n / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(digits)} ${units[unit]}`;
}

/** Bytes in binary units, as memory is read: 30.2 MiB, 7.6 GiB. */
export function memory(/** @type {number} */ n, digits = 1) {
  if (!Number.isFinite(n)) return "–";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(digits)} ${units[unit]}`;
}

/** 12.345 → "12.3%"; small values keep two digits. */
export function percent(/** @type {number} */ n) {
  if (!Number.isFinite(n)) return "–";
  if (n !== 0 && Math.abs(n) < 1) return `${n.toFixed(2)}%`;
  return `${n.toFixed(1)}%`;
}

/** A number with thousands separated. */
export function count(/** @type {number} */ n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "–";
}

/** Milliseconds as "2h 4m", "3m 20s", "12s", "850 ms". */
export function duration(/** @type {number} */ ms) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** A time as "just now", "4 minutes ago", "3 days ago"; `now` in ms. */
export function ago(/** @type {number} */ time, now = Date.now()) {
  if (!Number.isFinite(time) || time <= 0) return "–";
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const steps = /** @type {const} */ ([
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ]);
  let value = s / 60;
  for (const [size, name] of steps) {
    if (value < size) {
      const n = Math.floor(value);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
    value /= size;
  }
  return "long ago";
}

/** A docker time ("2024-05-01T10:00:00.123456789Z", "0001-01-01T00:00:00Z", "2024-05-01 10:00:00 +0900 KST") in ms; 0 when unset. */
export function time(/** @type {unknown} */ text) {
  if (typeof text === "number") return text > 1e12 ? text : text * 1000;
  if (typeof text !== "string" || text === "" || text.startsWith("0001-")) return 0;
  const iso = Date.parse(text);
  if (Number.isFinite(iso)) return iso;
  const match = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)/.exec(text);
  if (match) return Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return 0;
}

/** The first 12 hex digits of an id, without its "sha256:". */
export function short(/** @type {string} */ id) {
  return (id ?? "").replace(/^sha256:/, "").slice(0, 12);
}

/** A clock time "14:03:22" of ms. */
export function clock(/** @type {number} */ ms) {
  const d = new Date(ms);
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Singular or plural: plural(3, "container") → "3 containers". */
export function plural(/** @type {number} */ n, /** @type {string} */ word, many = `${word}s`) {
  return `${count(n)} ${n === 1 ? word : many}`;
}
