// Words and times for the screen: people, dates relative to today, and when an invitation is, in the
// person's zone and, when it differs, the zone the organizer wrote. Pure functions over Intl.
import { localZone, toWall } from "./ical/values.js";
import { dateTimeFormat } from "./intl.js";

/**
 * @typedef {{ name?: string, email?: string }} PersonRef
 * @typedef {import("./ical/values.js").When} When
 * @typedef {{ locale?: string, zone?: string, now?: number }} Clock
 */

/** "Mina", or the address when there is no name. @param {PersonRef | undefined} person */
export function personName(person) {
  return person?.name?.trim() || person?.email || "Unknown";
}

/** "Mina <mina@example.com>", or whichever half there is. @param {PersonRef} person */
export function personLine(person) {
  const name = person.name?.trim();
  if (name && person.email) return `${name} <${person.email}>`;
  return name || person.email || "";
}

/** Several people, comma separated. @param {PersonRef[] | undefined} people */
export const peopleLine = (people) => (people ?? []).map(personLine).join(", ");

const sameDay = (/** @type {Date} */ a, /** @type {Date} */ b, /** @type {string} */ zone) =>
  dateTimeFormat("en-CA", { timeZone: zone }).format(a) ===
  dateTimeFormat("en-CA", { timeZone: zone }).format(b);

/**
 * A message's time for its list row: the time today, the weekday this week, else the date.
 * @param {string} iso an RFC 3339 time
 * @param {Clock} [clock]
 */
export function listTime(iso, clock = {}) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date(clock.now ?? Date.now());
  const zone = clock.zone ?? localZone();
  const locale = clock.locale ?? "en-US";
  if (sameDay(at, now, zone))
    return dateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(
      at,
    );
  if (now.getTime() - at.getTime() < 6 * 86_400_000 && at.getTime() <= now.getTime())
    return dateTimeFormat(locale, { timeZone: zone, weekday: "short" }).format(at);
  const year = at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" };
  return dateTimeFormat(locale, { timeZone: zone, month: "short", day: "numeric", ...year }).format(
    at,
  );
}

/**
 * A message's full time for the reader: "Fri, 30 Oct 2026, 08:12".
 * @param {string} iso
 * @param {Clock} [clock]
 */
export function fullTime(iso, clock = {}) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return dateTimeFormat(clock.locale ?? "en-US", {
    timeZone: clock.zone ?? localZone(),
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** A wall time (ms as if UTC) as a date in words. */
const wallDate = (/** @type {number} */ wall, /** @type {string} */ locale) =>
  dateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(wall);
const wallClock = (/** @type {number} */ wall, /** @type {string} */ locale) =>
  dateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  }).format(wall);

/**
 * When an invitation is, as one line, plus the organizer's wall time when it was written in another
 * zone, and a note for a floating or an approximately placed time.
 * @param {{ start: When, end: When, allDay: boolean }} span
 * @param {Clock} [clock]
 * @returns {{ line: string, elsewhere?: string, note?: string }}
 */
export function whenLine({ start, end, allDay }, clock = {}) {
  const locale = clock.locale ?? "en-US";
  const zone = clock.zone ?? localZone();
  if (allDay) {
    const last = end.wall - 86_400_000;
    const line =
      last <= start.wall
        ? `${wallDate(start.wall, locale)} (all day)`
        : `${wallDate(start.wall, locale)} – ${wallDate(last, locale)} (all day)`;
    return { line };
  }
  const from = start.utc === undefined ? start.wall : toWall(start.utc, zone);
  const to = end.utc === undefined ? end.wall : toWall(end.utc, zone);
  const oneDay = wallDate(from, locale) === wallDate(to, locale);
  const line = oneDay
    ? `${wallDate(from, locale)}, ${wallClock(from, locale)} – ${wallClock(to, locale)}`
    : `${wallDate(from, locale)}, ${wallClock(from, locale)} – ${wallDate(to, locale)}, ${wallClock(to, locale)}`;
  /** @type {{ line: string, elsewhere?: string, note?: string }} */
  const out = { line };
  if (start.floating) out.note = "Written without a time zone: shown as your local time.";
  else if (start.approximate)
    out.note = `The zone ${start.zone} is not known here: shown at its standard offset.`;
  else if (start.zone && start.zone !== zone && start.zone !== "UTC")
    out.elsewhere = `${wallClock(start.wall, locale)} – ${wallClock(end.wall, locale)} in ${start.zone}`;
  return out;
}
