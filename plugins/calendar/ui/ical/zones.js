// Time zones for iCalendar times (RFC 5545 §3.2.19, §3.3.5, §3.6.5). A TZID is read, in order, as an
// IANA name (the platform's tz database through Intl), a Windows zone name (Outlook and Exchange),
// the VTIMEZONE the file defines, or an IANA name at the end of a prefixed TZID
// (/mozilla.org/20050126_1/America/New_York). A TZID none of them knows is read as floating, and
// the calendar says so. A local time a change skips is read with the offset before the change; a
// local time that happens twice is the first one (§3.3.5).
import { param, prop, props } from "./component.js";
import { expand } from "./recur.js";
import { parseRule } from "./rrule.js";
import { DAY, dayNumber, parseOffset, parseTime, wallOf } from "./values.js";
import { WINDOWS_ZONES } from "./windows-zones.js";

/**
 * A zone turns wall times into instants and back. `offset` is the zone's UTC offset at an instant,
 * in milliseconds.
 * @typedef {{ id: string, offset(utc: number): number, toUtc(wall: number): number }} Zone
 * @typedef {import("./component.js").Component} Component
 */

/**
 * The instant of a wall time in a zone given by its offsets.
 * @param {(utc: number) => number} offset
 * @param {number} wall
 */
export function toUtcWith(offset, wall) {
  // A day either side is before and after any change near this wall time.
  const before = offset(wall - DAY);
  const after = offset(wall + DAY);
  const early = wall - before;
  const late = wall - after;
  const earlyHolds = offset(early) === before;
  const lateHolds = offset(late) === after;
  if (earlyHolds && lateHolds) return Math.min(early, late);
  if (earlyHolds) return early;
  if (lateHolds) return late;
  return early;
}

/** @param {string} id @param {(utc: number) => number} offset @returns {Zone} */
const zone = (id, offset) => ({ id, offset, toUtc: (wall) => toUtcWith(offset, wall) });

export const UTC = zone("UTC", () => 0);

/** @type {Map<string, Zone | null>} */
const iana = new Map();

/**
 * A zone of the platform's tz database, or undefined when Intl does not know the name.
 * @param {string} name
 * @returns {Zone | undefined}
 */
export function ianaZone(name) {
  const known = iana.get(name);
  if (known !== undefined) return known ?? undefined;
  /** @type {Intl.DateTimeFormat} */
  let format;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: name,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    iana.set(name, null);
    return undefined;
  }
  /** @type {Map<number, number>} */
  const cache = new Map();
  const offset = (/** @type {number} */ utc) => {
    const at = Math.floor(utc / 1000) * 1000;
    const hit = cache.get(at);
    if (hit !== undefined) return hit;
    /** @type {Record<string, number>} */
    const parts = {};
    for (const part of format.formatToParts(new Date(at))) parts[part.type] = Number(part.value);
    const { year = 1970, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
    const wall = dayNumber(year, month, day) * DAY + ((hour * 60 + minute) * 60 + second) * 1000;
    if (cache.size > 20_000) cache.clear();
    cache.set(at, wall - at);
    return wall - at;
  };
  const resolved = zone(format.resolvedOptions().timeZone, offset);
  iana.set(name, resolved);
  return resolved;
}

/**
 * The zone a VTIMEZONE defines: its STANDARD and DAYLIGHT observances, each starting at DTSTART and
 * repeating by RRULE and RDATE, switch the offset from TZOFFSETFROM to TZOFFSETTO.
 * @param {Component} vtimezone
 * @param {string} id
 * @returns {Zone | undefined}
 */
export function vtimezoneZone(vtimezone, id) {
  /** @type {Array<{ at: number, to: number }>} */
  const changes = [];
  const end = dayNumber(2200, 1, 1) * DAY;
  let first = /** @type {{ at: number, from: number } | undefined} */ (undefined);
  for (const observance of vtimezone.components) {
    if (observance.name !== "STANDARD" && observance.name !== "DAYLIGHT") continue;
    const start = parseTime(prop(observance, "DTSTART")?.value ?? "");
    const from = parseOffset(prop(observance, "TZOFFSETFROM")?.value ?? "");
    const to = parseOffset(prop(observance, "TZOFFSETTO")?.value ?? "");
    if (!start || from === undefined || to === undefined) continue;
    const onset = wallOf(start);
    /** @type {number[]} */
    const walls = [onset];
    const rule = prop(observance, "RRULE");
    const parsed = rule ? parseRule(rule.value) : undefined;
    if (parsed && "rule" in parsed) {
      const { until } = parsed.rule;
      const pastUntil = (/** @type {number} */ wall) =>
        until
          ? until.date || !until.utc
            ? wall > wallOf(until)
            : wall - from > wallOf(until)
          : false;
      for (const wall of expand(parsed.rule, onset, { end, pastUntil })) walls.push(wall);
    }
    for (const rdate of props(observance, "RDATE"))
      for (const value of rdate.value.split(",")) {
        const time = parseTime(value.split("/")[0] ?? "");
        if (time) walls.push(wallOf(time));
      }
    for (const wall of new Set(walls)) changes.push({ at: wall - from, to });
    if (!first || onset - from < first.at) first = { at: onset - from, from };
  }
  if (!first) return undefined;
  changes.sort((a, b) => a.at - b.at);
  const initial = first.from;
  const offset = (/** @type {number} */ utc) => {
    let lo = 0;
    let hi = changes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((changes[mid]?.at ?? 0) <= utc) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? initial : (changes[found]?.to ?? initial);
  };
  return zone(id, offset);
}

/** The IANA zone of a Windows zone name (Outlook, Exchange). */
export const windowsZone = (/** @type {string} */ tzid) => {
  const name = WINDOWS_ZONES[tzid.trim()];
  return name ? ianaZone(name) : undefined;
};

/** The IANA zone named at the end of a longer TZID: /mozilla.org/20050126_1/America/New_York. */
export const suffixZone = (/** @type {string} */ tzid) => {
  const parts = tzid.split("/").filter(Boolean);
  for (const size of [3, 2]) {
    if (parts.length <= size) continue;
    const found = ianaZone(parts.slice(-size).join("/"));
    if (found) return found;
  }
  return undefined;
};

/** The person's zone: the setting when it names a zone, else the platform's. */
export function displayZone(/** @type {string | undefined} */ setting) {
  const platform = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (setting ? ianaZone(setting) : undefined) ?? ianaZone(platform) ?? UTC;
}

/**
 * The zones of one calendar: `get(tzid)` for times with a TZID, `floating` for times without one
 * (the calendar's X-WR-TIMEZONE when it names a zone, else the display zone). `unknown` collects the
 * TZIDs read as floating.
 * @param {Component} calendar
 * @param {Zone} display
 */
export function calendarZones(calendar, display) {
  /** @type {Map<string, Zone>} */
  const resolved = new Map();
  /** @type {Set<string>} */
  const unknown = new Set();
  const wr = prop(calendar, "X-WR-TIMEZONE")?.value.trim();
  const floating =
    (wr ? (ianaZone(wr) ?? windowsZone(wr) ?? suffixZone(wr)) : undefined) ?? display;
  const defined = (/** @type {string} */ tzid) =>
    calendar.components.find(
      (c) => c.name === "VTIMEZONE" && prop(c, "TZID")?.value.trim() === tzid,
    );
  return {
    floating,
    unknown,
    /** @param {string | undefined} tzid */
    get(tzid) {
      if (!tzid) return floating;
      const hit = resolved.get(tzid);
      if (hit) return hit;
      const vtimezone = defined(tzid);
      const found =
        ianaZone(tzid) ??
        windowsZone(tzid) ??
        (vtimezone ? vtimezoneZone(vtimezone, tzid) : undefined) ??
        suffixZone(tzid);
      if (!found) unknown.add(tzid);
      const result = found ?? floating;
      resolved.set(tzid, result);
      return result;
    },
  };
}

/**
 * The zone of a property's TZID parameter.
 * @param {ReturnType<typeof calendarZones>} zones
 * @param {import("./lines.js").Prop | undefined} property
 */
export const zoneOf = (zones, property) => zones.get(param(property, "TZID"));
