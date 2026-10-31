// Templates for desk.views (specs/view/v0): `{path}` is a field of the item in scope, `{params.name}`
// a param, `{now}`, `{today}`, `{tomorrow}` and `{yesterday}` the engine's clock in the view's zone,
// and `|time`, `|date`, `|relative` and `|number` format the value. `{{` and `}}` are braces. There are
// no expressions: anything else in braces stays as written. Pure, without a DOM.

/**
 * @typedef {{ zone: string, locale: string, now: number, params: Record<string, unknown> }} Env
 * @typedef {"time" | "date" | "relative" | "number"} Format
 */

const PLACEHOLDER =
  /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)(?:\|(time|date|relative|number))?\}/y;
const ALONE = /^\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)\}$/;
const CLOCK = new Set(["now", "today", "tomorrow", "yesterday"]);
const DAY = 86_400_000;

/**
 * The value at a dotted path (`start`, `source.instance`, `points.0.v`), or undefined.
 * @param {unknown} value
 * @param {string} path
 * @returns {unknown}
 */
export function valueAt(value, path) {
  let at = value;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = /** @type {Record<string, unknown>} */ (at)[key];
  }
  return at;
}

/**
 * A zone's wall-clock fields at an instant, and its offset from UTC in minutes.
 * @param {number} ms
 * @param {string} zone
 */
function wall(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(ms);
  const get = (/** @type {string} */ type) => Number(parts.find((p) => p.type === type)?.value);
  const fields = {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  return { ...fields, offset: Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000) };
}

const two = (/** @type {number} */ n) => String(Math.abs(n)).padStart(2, "0");

/**
 * An instant as RFC 3339 with the zone's offset there: 2026-10-30T09:00:00+09:00.
 * @param {number} ms
 * @param {string} zone
 */
export function rfc3339(ms, zone) {
  const w = wall(ms, zone);
  const sign = w.offset < 0 ? "-" : "+";
  const offset = `${sign}${two(Math.trunc(w.offset / 60))}:${two(w.offset % 60)}`;
  return `${w.year}-${two(w.month)}-${two(w.day)}T${two(w.hour)}:${two(w.minute)}:${two(w.second)}${offset}`;
}

/**
 * The start of a day in a zone, `days` and `months` from the day of `ms`, as an instant.
 * @param {number} ms
 * @param {string} zone
 * @param {{ days?: number, months?: number }} [shift]
 */
export function dayStart(ms, zone, { days = 0, months = 0 } = {}) {
  const w = wall(ms, zone);
  const midnight = Date.UTC(w.year, w.month - 1 + months, w.day + days);
  // The offset at that midnight can differ from now's (a daylight saving change): ask again.
  let guess = midnight - w.offset * 60_000;
  guess = midnight - wall(guess, zone).offset * 60_000;
  return guess;
}

/**
 * The engine's clock names as RFC 3339 instants in a zone.
 * @param {number} now
 * @param {string} zone
 */
export function clockOf(now, zone) {
  return {
    now: rfc3339(now, zone),
    today: rfc3339(dayStart(now, zone), zone),
    tomorrow: rfc3339(dayStart(now, zone, { days: 1 }), zone),
    yesterday: rfc3339(dayStart(now, zone, { days: -1 }), zone),
  };
}

/**
 * What a placeholder's path names: a param, the clock, or a field of the item.
 * @param {string} path
 * @param {unknown} scope
 * @param {Env} env
 */
function lookup(path, scope, env) {
  if (path.startsWith("params.")) return valueAt(env.params, path.slice("params.".length));
  if (CLOCK.has(path)) return clockOf(env.now, env.zone)[/** @type {"now"} */ (path)];
  return valueAt(scope, path);
}

/** A value as text: people by name, lists joined, nothing for objects and absent values. */
function text(/** @type {unknown} */ value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const { name, email } = /** @type {{ name?: unknown, email?: unknown }} */ (value);
    return typeof (name ?? email) === "string" ? String(name ?? email) : "";
  }
  return String(value);
}

/**
 * The value of a relative time, in the largest unit that keeps it at least one.
 * @param {number} ms
 * @returns {[number, Intl.RelativeTimeFormatUnit]}
 */
function relative(ms) {
  const abs = Math.abs(ms);
  /** @type {Array<[number, Intl.RelativeTimeFormatUnit]>} */
  const units = [
    [365 * DAY, "year"],
    [30 * DAY, "month"],
    [7 * DAY, "week"],
    [DAY, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ];
  for (const [size, unit] of units) if (abs >= size) return [Math.round(ms / size), unit];
  return [Math.round(ms / 1000), "second"];
}

/**
 * One formatted value.
 * @param {unknown} value
 * @param {Format | undefined} format
 * @param {Env} env
 */
function formatted(value, format, env) {
  if (!format) return text(value);
  if (format === "number") {
    const n = typeof value === "number" ? value : Number(text(value) || Number.NaN);
    return Number.isFinite(n) ? new Intl.NumberFormat(env.locale).format(n) : "";
  }
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) return "";
  if (format === "relative") {
    const [amount, unit] = relative(ms - env.now);
    return new Intl.RelativeTimeFormat(env.locale, { numeric: "auto" }).format(amount, unit);
  }
  const options =
    format === "time"
      ? /** @type {const} */ ({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      : /** @type {const} */ ({ weekday: "short", month: "short", day: "numeric" });
  return new Intl.DateTimeFormat(env.locale, { ...options, timeZone: env.zone }).format(ms);
}

/**
 * Fill a template with an item (or nothing) in scope.
 * @param {string} template
 * @param {unknown} scope
 * @param {Env} env
 * @returns {string}
 */
export function fill(template, scope, env) {
  let out = "";
  let at = 0;
  while (at < template.length) {
    const pair = template.slice(at, at + 2);
    if (pair === "{{" || pair === "}}") {
      out += pair[0];
      at += 2;
      continue;
    }
    PLACEHOLDER.lastIndex = at;
    const match = template[at] === "{" ? PLACEHOLDER.exec(template) : null;
    if (match) {
      const [whole, path = "", format] = match;
      out += formatted(lookup(path, scope, env), /** @type {Format | undefined} */ (format), env);
      at += whole.length;
    } else {
      out += template[at];
      at += 1;
    }
  }
  return out;
}

/**
 * Fill every string in a JSON value (a where value, an action's args). A string that is one
 * placeholder alone keeps the value's type, so `{params.days}` stays a number.
 * @template T
 * @param {T} value
 * @param {unknown} scope
 * @param {Env} env
 * @returns {T}
 */
export function fillValue(value, scope, env) {
  if (typeof value === "string") {
    const alone = ALONE.exec(value);
    if (alone) {
      const found = lookup(alone[1] ?? "", scope, env);
      return /** @type {T} */ (found === undefined || found === null ? "" : structuredClone(found));
    }
    return /** @type {T} */ (fill(value, scope, env));
  }
  if (Array.isArray(value)) return /** @type {T} */ (value.map((v) => fillValue(v, scope, env)));
  if (value !== null && typeof value === "object")
    return /** @type {T} */ (
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillValue(v, scope, env)]))
    );
  return value;
}

/**
 * The path of a template's first placeholder (what a column sorts by), or undefined.
 * @param {string} template
 */
export function firstPath(template) {
  const plain = template.replaceAll("{{", "").replaceAll("}}", "");
  return /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)(?:\|[a-z]+)?\}/.exec(plain)?.[1];
}
