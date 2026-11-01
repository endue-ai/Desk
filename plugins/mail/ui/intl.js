// ICU formatter construction can block mail reading, especially on Windows. Reuse explicit
// locale/zone/options pairs, with bounded caches because documents supply time-zone names.
// The system's current zone is never cached here: callers resolve it for each render.

const LIMIT = 64;
/** @type {Map<string, Intl.DateTimeFormat>} */
const formats = new Map();
/** @type {Map<string, boolean>} */
const zones = new Map();

/** @template T @param {Map<string, T>} cache @param {string} key @param {T} value */
function remember(cache, key, value) {
  if (cache.size >= LIMIT) cache.delete(cache.keys().next().value ?? "");
  cache.set(key, value);
  return value;
}

/**
 * A formatter with an explicit time zone. Options are sorted so equivalent requests share it.
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions & { timeZone: string }} options
 */
export function dateTimeFormat(locale, options) {
  const key = JSON.stringify([
    locale,
    Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const held = formats.get(key);
  if (held) return held;
  return remember(formats, key, new Intl.DateTimeFormat(locale, options));
}

/** Whether ICU recognizes a zone; remember refusals too, without keeping unbounded input. */
export function knowsZone(/** @type {string} */ name) {
  const held = zones.get(name);
  if (held !== undefined) return held;
  try {
    dateTimeFormat("en-US", { timeZone: name });
    return remember(zones, name, true);
  } catch {
    return remember(zones, name, false);
  }
}
