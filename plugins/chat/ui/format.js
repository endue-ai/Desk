// Words and times for the screen: a message's clock time, a day's heading ("Today", "Yesterday",
// "Thursday, October 29"), a short time for lists, the size of a file and a badge. Formatters
// are cached per locale, zone and options, since ICU construction is slow (as in the mail plugin);
// the zone of the person is read at each call, never cached. Pure functions over Intl.

/**
 * @typedef {{ locale?: string, zone?: string, now?: number }} Clock
 */

const LIMIT = 64;
/** @type {Map<string, Intl.DateTimeFormat>} */
const formats = new Map();

/** @param {string} locale @param {Intl.DateTimeFormatOptions & { timeZone: string }} options */
function format(locale, options) {
  const key = JSON.stringify([
    locale,
    Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const held = formats.get(key);
  if (held) return held;
  if (formats.size >= LIMIT) formats.delete(formats.keys().next().value ?? "");
  const made = new Intl.DateTimeFormat(locale, options);
  formats.set(key, made);
  return made;
}

/** The person's time zone now. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The calendar day of an instant in a zone, as YYYY-MM-DD. */
export function dayOf(/** @type {number} */ time, /** @type {string} */ zone) {
  return format("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}

/** "08:12": a message's clock time. */
export function clockTime(/** @type {string} */ iso, /** @type {Clock} */ clock = {}) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return format(clock.locale ?? "en-US", {
    timeZone: clock.zone ?? localZone(),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** "Fri, Oct 30, 2026, 08:12": a message's full time, for its title. */
export function fullTime(/** @type {string} */ iso, /** @type {Clock} */ clock = {}) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return format(clock.locale ?? "en-US", {
    timeZone: clock.zone ?? localZone(),
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** A day's heading in a conversation: Today, Yesterday, the weekday and date (and year). */
export function dayLabel(/** @type {number} */ time, /** @type {Clock} */ clock = {}) {
  const zone = clock.zone ?? localZone();
  const now = clock.now ?? Date.now();
  const day = dayOf(time, zone);
  if (day === dayOf(now, zone)) return "Today";
  if (day === dayOf(now - 86_400_000, zone)) return "Yesterday";
  const year = day.slice(0, 4) === dayOf(now, zone).slice(0, 4) ? {} : { year: "numeric" };
  return format(clock.locale ?? "en-US", {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
    ...year,
  }).format(time);
}

/** A list row's time: the clock today, the weekday this week, else the date. */
export function shortTime(/** @type {string} */ iso, /** @type {Clock} */ clock = {}) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const zone = clock.zone ?? localZone();
  const now = clock.now ?? Date.now();
  const locale = clock.locale ?? "en-US";
  if (dayOf(at, zone) === dayOf(now, zone)) return clockTime(iso, clock);
  if (now - at < 6 * 86_400_000 && at <= now)
    return format(locale, { timeZone: zone, weekday: "short" }).format(at);
  return format(locale, { timeZone: zone, month: "short", day: "numeric" }).format(at);
}

/** "2 KB", "1.5 MB": a file's size. */
export function sizeText(/** @type {number | undefined} */ bytes) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** A badge's number: as is up to 99, then "99+". */
export const badge = (/** @type {number} */ n) => (n > 99 ? "99+" : String(n));

/** How unread and mentions read aloud: "3 unread, 1 mention". */
export function countsLabel(/** @type {number} */ unread, /** @type {number} */ mentions) {
  const parts = [];
  if (unread > 0) parts.push(`${unread} unread`);
  if (mentions > 0) parts.push(`${mentions} ${mentions === 1 ? "mention" : "mentions"}`);
  return parts.join(", ");
}

/** The two letters an avatar shows: the initials of the first two words, else two letters. */
export function initials(/** @type {string} */ name) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length > 1
      ? `${[...(words[0] ?? "")][0] ?? ""}${[...(words[1] ?? "")][0] ?? ""}`
      : [...(words[0] ?? "")].slice(0, 2).join("");
  return letters.toUpperCase();
}

/** Names as a sentence lists them: "Slack", "Slack or Discord", "Discord, Matrix or Slack". */
export const anyOf = (/** @type {string[]} */ names) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
