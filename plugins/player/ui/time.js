// Times and sizes as people read them: 0:05, 12:34, 1:02:03; 980 KB, 1.2 GB.

/** Seconds as m:ss, or h:mm:ss from an hour. */
export function clock(/** @type {number} */ seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A cue's time with milliseconds: 0:01:05.250. */
export function cueTime(/** @type {number} */ seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, "0")}`;
}

/** Bytes in decimal units, as the Finder shows them. */
export function bytes(/** @type {number} */ size) {
  if (size < 1000) return `${size} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  let unit = "";
  for (const u of units) {
    value /= 1000;
    unit = u;
    if (value < 1000) break;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}
