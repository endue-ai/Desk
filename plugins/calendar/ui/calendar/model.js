// A calendar as the plugin shows it: the VEVENTs of a parsed iCalendar file grouped into series by UID
// (a master and its RECURRENCE-ID overrides), and the occurrences that fall in a window of time
// (RFC 5545 §3.6.1, §3.8.5). Times are instants in milliseconds; all-day events keep their dates and
// begin at midnight in the display zone. Nothing here changes the file.
import { param, prop, props, text } from "../ical/component.js";
import { splitList } from "../ical/lines.js";
import { expand } from "../ical/recur.js";
import { parseRule } from "../ical/rrule.js";
import {
  DAY,
  durationParts,
  formatTime,
  parseDuration,
  parseTime,
  timeAt,
  wallOf,
} from "../ical/values.js";
import { calendarZones, UTC } from "../ical/zones.js";

/**
 * @typedef {import("../ical/component.js").Component} Component
 * @typedef {import("../ical/component.js").Document} Document
 * @typedef {import("../ical/values.js").TimeValue} TimeValue
 * @typedef {import("../ical/zones.js").Zone} Zone
 * @typedef {import("../ical/rrule.js").Rule} Rule
 *
 * @typedef {object} EventInfo one VEVENT as read
 * @property {Component} component
 * @property {Component} calendar the VCALENDAR it is in
 * @property {string} uid
 * @property {TimeValue} start
 * @property {Zone} zone the zone of DTSTART (the display zone for dates)
 * @property {boolean} allDay
 * @property {(start: number) => number} endOf the end instant of an instance that starts at `start`
 *   (an instant; for all-day events the wall time of its first day)
 * @property {Rule} [rule]
 * @property {string} [ruleError]
 * @property {TimeValue} [recurrenceId]
 * @property {string} [recurrenceKey] the instance of its series it replaces, as instanceKey keys it
 * @property {boolean} cancelled
 * @property {ReturnType<typeof calendarZones>} zones the zones of its calendar
 *
 * @typedef {object} Series a master and the overrides of its instances, by instance key
 * @property {EventInfo | undefined} master
 * @property {Map<string, EventInfo>} overrides
 *
 * @typedef {object} Occurrence one event on the calendar
 * @property {string} id the UID, then @ and the instance key for an instance of a series
 * @property {string} uid
 * @property {string} [instance] the instance key (RECURRENCE-ID) when it belongs to a series
 * @property {number} start an instant; an all-day event's is midnight in the display zone
 * @property {number} end
 * @property {number} startWall the start as a wall time in the display zone
 * @property {number} endWall
 * @property {boolean} allDay
 * @property {string} title
 * @property {string} [location]
 * @property {string} [description]
 * @property {"CONFIRMED" | "TENTATIVE" | "CANCELLED" | string} status
 * @property {boolean} free TRANSP:TRANSPARENT, or an all-day event that does not say OPAQUE
 * @property {boolean} recurring
 * @property {EventInfo} event the VEVENT that describes it: the override, or the master
 * @property {EventInfo | undefined} master
 *
 * @typedef {object} Model
 * @property {Document} doc
 * @property {Zone} display
 * @property {string} name
 * @property {string} [color]
 * @property {Map<string, Series>} series by UID
 * @property {string[]} problems sentences about what could not be read
 */

/**
 * The key of an instance: the date for DATE starts, the wall time for floating ones, the UTC
 * instant otherwise. RECURRENCE-ID and generated instances meet on it.
 * @param {TimeValue} value
 * @param {Zone} zone
 */
export function instanceKey(value, zone) {
  if (value.date || (!value.utc && !value.tzid)) return formatTime(value);
  const utc = value.utc ? wallOf(value) : zone.toUtc(wallOf(value));
  return formatTime(timeAt(utc, { date: false, y: 0, m: 0, d: 0, h: 0, mi: 0, s: 0, utc: true }));
}

/**
 * Read every VEVENT of a parsed file.
 * @param {Document} doc
 * @param {Zone} display
 * @param {string} fallbackName the calendar's name when the file gives none
 * @returns {Model}
 */
export function buildModel(doc, display, fallbackName) {
  /** @type {Map<string, Series>} */
  const series = new Map();
  /** @type {string[]} */
  const problems = doc.problems.map((p) => p.message);
  const first = doc.calendars[0];
  const name =
    (first && (text(first, "NAME") ?? text(first, "X-WR-CALNAME"))?.trim()) || fallbackName;
  const color = first && (prop(first, "COLOR") ?? prop(first, "X-APPLE-CALENDAR-COLOR"))?.value;
  let untitled = 0;
  for (const calendar of doc.calendars) {
    const zones = calendarZones(calendar, display);
    for (const component of calendar.components) {
      if (component.name !== "VEVENT") continue;
      const info = readEvent(component, calendar, zones, display, problems);
      if (!info) continue;
      if (!prop(component, "UID")) info.uid = `no-uid-${++untitled}`;
      const entry = series.get(info.uid) ?? { master: undefined, overrides: new Map() };
      series.set(info.uid, entry);
      if (info.recurrenceKey) entry.overrides.set(info.recurrenceKey, info);
      else if (entry.master) {
        problems.push(`Two events share the UID ${info.uid}; the second is shown on its own.`);
        series.set(`${info.uid}#${++untitled}`, { master: info, overrides: new Map() });
      } else entry.master = info;
    }
    for (const tzid of zones.unknown)
      problems.push(`The time zone ${tzid} is unknown; its times are read as local times.`);
  }
  return { doc, display, name, ...(color ? { color } : {}), series, problems };
}

/**
 * @param {Component} component
 * @param {Component} calendar
 * @param {ReturnType<typeof calendarZones>} zones
 * @param {Zone} display
 * @param {string[]} problems
 * @returns {EventInfo | undefined}
 */
function readEvent(component, calendar, zones, display, problems) {
  const uid = prop(component, "UID")?.value.trim() ?? "";
  const label = text(component, "SUMMARY") ?? uid;
  /** @param {import("../ical/lines.js").Prop | undefined} p */
  const timeOf = (p) => (p ? parseTime(p.value, param(p, "TZID")) : undefined);
  /** @param {TimeValue} value */
  const zoneOf = (value) =>
    value.date ? display : value.utc ? UTC : value.tzid ? zones.get(value.tzid) : zones.floating;

  const startProp = prop(component, "DTSTART");
  const recurrenceProp = prop(component, "RECURRENCE-ID");
  const recurrenceId = timeOf(recurrenceProp);
  const start = timeOf(startProp) ?? recurrenceId;
  if (!start) {
    problems.push(`The event "${label}" has no start time and is not shown.`);
    return undefined;
  }
  if (param(recurrenceProp, "RANGE") === "THISANDFUTURE")
    problems.push(`The change to "${label}" for this and later events applies to one event only.`);
  const zone = zoneOf(start);
  const allDay = start.date;

  const endValue = timeOf(prop(component, "DTEND"));
  const duration = parseDuration(prop(component, "DURATION")?.value ?? "");
  /** @type {(start: number) => number} */
  let endOf;
  if (endValue && endValue.date === allDay) {
    const length = allDay
      ? wallOf(endValue) - wallOf(start)
      : zoneOf(endValue).toUtc(wallOf(endValue)) - zone.toUtc(wallOf(start));
    if (length < 0) problems.push(`The event "${label}" ends before it starts.`);
    endOf = (at) => at + Math.max(0, length);
  } else if (duration) {
    // Days in a DURATION follow the wall clock; hours are exact (§3.3.6).
    const { nominal, exact } = durationParts(duration);
    endOf = allDay
      ? (at) => at + Math.max(DAY, nominal + Math.ceil(exact / DAY) * DAY)
      : (at) => zone.toUtc(at + zone.offset(at) + nominal) + exact;
  } else endOf = (at) => (allDay ? at + DAY : at);

  const ruleProp = prop(component, "RRULE");
  const parsedRule = ruleProp && !recurrenceId ? parseRule(ruleProp.value) : undefined;
  if (parsedRule && "error" in parsedRule)
    problems.push(`The repeat rule of "${label}" is not understood (${parsedRule.error}).`);
  const status = prop(component, "STATUS")?.value.trim().toUpperCase();
  return {
    component,
    calendar,
    uid,
    start,
    zone,
    allDay,
    endOf,
    ...(parsedRule && "rule" in parsedRule ? { rule: parsedRule.rule } : {}),
    ...(parsedRule && "error" in parsedRule ? { ruleError: parsedRule.error } : {}),
    ...(recurrenceId
      ? { recurrenceId, recurrenceKey: instanceKey(recurrenceId, zoneOf(recurrenceId)) }
      : {}),
    cancelled: status === "CANCELLED",
    zones,
  };
}

/**
 * The instants (all-day: wall times) an EventInfo's start and its RDATE and EXDATE values name, in
 * the zone of its start, keyed as instanceKey keys them.
 * @param {EventInfo} info
 * @param {string} name RDATE or EXDATE
 * @param {Model} model
 */
function dates(info, name, model) {
  /** @type {Array<{ key: string, wall: number, end?: number }>} */
  const out = [];
  const zones = info.zones;
  for (const p of props(info.component, name)) {
    const tzid = param(p, "TZID");
    for (const part of splitList(p.value)) {
      const [first, second] = part.split("/");
      const value = parseTime(first ?? "", tzid);
      if (!value) continue;
      const zone = value.date ? model.display : value.utc ? UTC : zones.get(value.tzid);
      const key = instanceKey(value, zone);
      // In the start's zone, so it joins the rule's walls.
      const utc = value.utc ? wallOf(value) : zone.toUtc(wallOf(value));
      const wall = info.allDay || value.date ? wallOf(value) : utc + info.zone.offset(utc);
      const until = second ? parseTime(second, tzid) : undefined;
      const length = second && !until ? parseDuration(second) : undefined;
      const end = until
        ? until.utc
          ? wallOf(until)
          : zone.toUtc(wallOf(until))
        : length
          ? utc + durationParts(length).nominal + durationParts(length).exact
          : undefined;
      out.push({ key, wall, ...(end !== undefined ? { end } : {}) });
    }
  }
  return out;
}

/**
 * Every occurrence that overlaps [from, to), sorted by start, then all-day first, then title.
 * @param {Model} model
 * @param {number} from
 * @param {number} to
 * @returns {Occurrence[]}
 */
export function occurrences(model, from, to) {
  /** @type {Occurrence[]} */
  const out = [];
  const display = model.display;
  for (const [uid, { master, overrides }] of model.series) {
    const recurring = Boolean(master?.rule || (master && props(master.component, "RDATE").length));
    /** @param {EventInfo} event @param {number} wall the start's wall time in event.zone @param {string} [instance] @param {number} [end] */
    const add = (event, wall, instance, end) => {
      const start = event.allDay ? display.toUtc(wall) : event.zone.toUtc(wall);
      const stop = end ?? (event.allDay ? display.toUtc(event.endOf(wall)) : event.endOf(start));
      if (!(start < to && (stop > from || (stop === start && start >= from)))) return;
      out.push(occurrence(event, master, uid, start, stop, instance, display, recurring));
    };
    for (const [key, override] of overrides) {
      if (override.cancelled && master) continue;
      add(override, wallOf(override.start), key);
    }
    if (!master) continue;
    if (!recurring) {
      add(master, wallOf(master.start));
      continue;
    }
    const zone = master.zone;
    const startWall = wallOf(master.start);
    // The first instance's length bounds how early an instance may start and still reach `from`.
    const first = master.allDay ? startWall : zone.toUtc(startWall);
    const longest = Math.max(DAY, master.endOf(first) - first);
    const fromWall = from + zone.offset(from) - longest - DAY;
    const toWall = to + zone.offset(to) + DAY;
    const excluded = new Set(dates(master, "EXDATE", model).map((d) => d.key));
    const seen = new Set();
    /** @param {number} wall @param {number} [end] */
    const instance = (wall, end) => {
      const key = instanceKey(timeAt(wall, master.start), zone);
      if (seen.has(key)) return;
      seen.add(key);
      if (excluded.has(key) || overrides.has(key)) return;
      add(master, wall, key, end);
    };
    if (master.rule) {
      const until = master.rule.until;
      const pastUntil = (/** @type {number} */ wall) =>
        !until
          ? false
          : until.date
            ? Math.floor(wall / DAY) > Math.floor(wallOf(until) / DAY)
            : until.utc && !master.start.date
              ? zone.toUtc(wall) > wallOf(until)
              : wall > wallOf(until);
      for (const wall of expand(master.rule, startWall, { end: toWall, from: fromWall, pastUntil }))
        instance(wall);
    } else instance(startWall);
    for (const rdate of dates(master, "RDATE", model)) instance(rdate.wall, rdate.end);
  }
  return out.sort(
    (a, b) =>
      a.start - b.start ||
      Number(b.allDay) - Number(a.allDay) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * @param {EventInfo} event
 * @param {EventInfo | undefined} master
 * @param {string} uid
 * @param {number} start
 * @param {number} end
 * @param {string | undefined} instance
 * @param {Zone} display
 * @param {boolean} recurring
 * @returns {Occurrence}
 */
function occurrence(event, master, uid, start, end, instance, display, recurring) {
  const c = event.component;
  const transp = prop(c, "TRANSP")?.value.trim().toUpperCase();
  const location = text(c, "LOCATION");
  const description = text(c, "DESCRIPTION");
  return {
    id: instance ? `${uid}@${instance}` : uid,
    uid: event.uid || uid,
    ...(instance ? { instance } : {}),
    start,
    end,
    startWall: start + display.offset(start),
    endWall: end + display.offset(end),
    allDay: event.allDay,
    title: text(c, "SUMMARY")?.trim() || "(No title)",
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    status: prop(c, "STATUS")?.value.trim().toUpperCase() ?? "CONFIRMED",
    free: transp ? transp === "TRANSPARENT" : event.allDay,
    recurring,
    event,
    master,
  };
}
