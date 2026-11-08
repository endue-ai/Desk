// Writing the properties of a VEVENT from what the person entered: times in a zone (or all-day dates,
// or floating), text, the repeat rule, one reminder, busy or free, and the stamps RFC 5545 asks for
// on every change (DTSTAMP, LAST-MODIFIED, SEQUENCE). Writes go through setProp, so the properties
// another app put on the event stay where they were.
import { prop, setProp, text } from "../ical/component.js";
import { escapeText } from "../ical/lines.js";
import { parseRule } from "../ical/rrule.js";
import {
  DAY,
  durationOf,
  durationParts,
  formatDuration,
  formatTime,
  parseDuration,
  timeAt,
  wallOf,
} from "../ical/values.js";
import { vtimezoneFor } from "../ical/vtimezone.js";
import { ianaZone, UTC } from "../ical/zones.js";

/**
 * @typedef {import("../ical/component.js").Component} Component
 * @typedef {import("../ical/lines.js").Prop} Prop
 * @typedef {import("../ical/values.js").TimeValue} TimeValue
 * @typedef {import("../ical/zones.js").Zone} Zone
 *
 * What the editor hands over. Times are wall times in `zone`; an all-day event's are midnights and
 * its end is the day after its last day. `rrule` and `reminder` are left as they are when undefined;
 * null takes them away.
 * @typedef {object} EventFields
 * @property {string} title
 * @property {boolean} allDay
 * @property {number} start
 * @property {number} end
 * @property {string} zone an IANA zone, UTC, or the empty string for a floating time
 * @property {string} [location]
 * @property {string} [description]
 * @property {string | null} [rrule] the RECUR value, without UNTIL handling
 * @property {number | null} [reminder] minutes before the start (negative: after it)
 * @property {boolean} [free]
 */

export const PRODID = "-//endue//Desk Calendar 0.1//EN";

/** The kinds of value timeAt makes: a DATE, and a floating DATE-TIME. */
const DATE = /** @type {const} */ ({ date: true, y: 0, m: 0, d: 0 });
const TIME = /** @type {const} */ ({
  date: false,
  y: 0,
  m: 0,
  d: 0,
  h: 0,
  mi: 0,
  s: 0,
  utc: false,
});

/**
 * The zone of a field's zone name: UTC, an IANA zone, or undefined for floating.
 * @param {string} name
 * @returns {Zone | undefined}
 */
export const zoneNamed = (name) => (name === "UTC" ? UTC : name ? ianaZone(name) : undefined);

/**
 * A time property for a wall time: a DATE, a UTC DATE-TIME, a DATE-TIME with TZID, or floating.
 * @param {string} name
 * @param {number} wall
 * @param {boolean} allDay
 * @param {string} zone
 * @returns {Prop}
 */
export function timeProp(name, wall, allDay, zone) {
  if (allDay) return { name, params: { VALUE: ["DATE"] }, value: formatTime(timeAt(wall, DATE)) };
  if (zone === "UTC")
    return { name, params: {}, value: formatTime(timeAt(wall, { ...TIME, utc: true })) };
  const value = formatTime(timeAt(wall, TIME));
  return { name, params: zone ? { TZID: [zone] } : {}, value };
}

/**
 * A time property for one instance of a series, written the way the series' DTSTART is written:
 * `key` is an instance key (instanceKey in model.js).
 * @param {string} name RECURRENCE-ID or EXDATE
 * @param {string} key
 * @param {TimeValue} like the series' DTSTART
 * @param {Zone} zone the zone of the series' DTSTART
 * @returns {Prop}
 */
export function instanceProp(name, key, like, zone) {
  if (like.date) return { name, params: { VALUE: ["DATE"] }, value: key.slice(0, 8) };
  if (!like.tzid) return { name, params: {}, value: key };
  // A TZID series keys its instances by their UTC instant; write them in the series' zone.
  const utc = Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
    Number(key.slice(9, 11)),
    Number(key.slice(11, 13)),
    Number(key.slice(13, 15)),
  );
  const wall = utc + zone.offset(utc);
  return { name, params: { TZID: [like.tzid] }, value: formatTime(timeAt(wall, like)) };
}

/** A UTC DATE-TIME for DTSTAMP, LAST-MODIFIED and CREATED. */
export const stamp = (/** @type {string} */ name, /** @type {number} */ now) => ({
  name,
  params: {},
  value: formatTime(timeAt(now, { ...TIME, utc: true })),
});

/**
 * Mark a change: DTSTAMP and LAST-MODIFIED become now, and SEQUENCE goes up when the change moved
 * the event or its rule (a "significant revision", §3.8.7.4).
 * @param {Component} event
 * @param {number} now
 * @param {boolean} significant
 */
export function touch(event, now, significant) {
  setProp(event, "DTSTAMP", stamp("DTSTAMP", now));
  setProp(event, "LAST-MODIFIED", stamp("LAST-MODIFIED", now));
  if (!significant) return;
  const sequence = Number(prop(event, "SEQUENCE")?.value ?? "0");
  setProp(event, "SEQUENCE", {
    name: "SEQUENCE",
    params: {},
    value: String(Number.isFinite(sequence) ? sequence + 1 : 1),
  });
}

/**
 * Set a TEXT property, or take it away when the text is empty.
 * @param {Component} event
 * @param {string} name
 * @param {string | undefined} value
 */
export function setText(event, name, value) {
  const trimmed = value?.trim() ?? "";
  // Unchanged text keeps the property as written, its parameters (LANGUAGE, ALTREP) included.
  if ((text(event, name) ?? "").trim() === trimmed) return;
  setProp(event, name, trimmed ? { name, params: {}, value: escapeText(trimmed) } : undefined);
}

/**
 * Write the fields onto a VEVENT, touching only what they change. With `times` false, DTSTART and
 * DTEND stay as written (another app's TZID with them). Returns whether the change is significant.
 * @param {Component} event
 * @param {EventFields} fields
 * @param {{ times?: boolean }} [options]
 */
export function writeFields(event, fields, { times = true } = {}) {
  const before = JSON.stringify(
    ["DTSTART", "DTEND", "DURATION", "RRULE"].map((n) => prop(event, n)),
  );
  setText(event, "SUMMARY", fields.title || "(No title)");
  if (times) {
    setProp(event, "DTSTART", timeProp("DTSTART", fields.start, fields.allDay, fields.zone));
    setProp(event, "DURATION", undefined);
    setProp(event, "DTEND", timeProp("DTEND", fields.end, fields.allDay, fields.zone));
  }
  if (fields.location !== undefined) setText(event, "LOCATION", fields.location);
  if (fields.description !== undefined) setText(event, "DESCRIPTION", fields.description);
  // TRANSP is written only when it changes what the event already says (§3.8.2.7: OPAQUE when absent).
  const transp = prop(event, "TRANSP")?.value.trim().toUpperCase();
  const free = transp ? transp === "TRANSPARENT" : fields.allDay;
  if (fields.free !== undefined && fields.free !== free)
    setProp(event, "TRANSP", {
      name: "TRANSP",
      params: {},
      value: fields.free ? "TRANSPARENT" : "OPAQUE",
    });
  if (fields.rrule !== undefined && fields.rrule !== (prop(event, "RRULE")?.value ?? null))
    setProp(
      event,
      "RRULE",
      fields.rrule ? { name: "RRULE", params: {}, value: fields.rrule } : undefined,
    );
  fitUntil(event, fields);
  if (fields.reminder !== undefined && fields.reminder !== reminderOf(event))
    setReminder(event, fields.reminder, fields.title);
  return (
    before !== JSON.stringify(["DTSTART", "DTEND", "DURATION", "RRULE"].map((n) => prop(event, n)))
  );
}

/**
 * Write UNTIL the way DTSTART is written, as §3.3.10 requires: a DATE for an all-day event, UTC for
 * a time in a zone, a floating time for a floating one. The last day or instant stays the same.
 * @param {Component} event
 * @param {EventFields} fields
 */
function fitUntil(event, fields) {
  const rrule = prop(event, "RRULE");
  const parsed = rrule ? parseRule(rrule.value) : undefined;
  if (!rrule || !parsed || "error" in parsed || !parsed.rule.until) return;
  const until = parsed.rule.until;
  const zone = zoneNamed(fields.zone);
  // The last moment UNTIL allows: the end of a DATE's day, or the time itself (an instant for UTC).
  const last = until.date ? wallOf(until) + DAY - 1000 : wallOf(until);
  const next = fields.allDay
    ? timeAt(last, DATE)
    : zone
      ? timeAt(until.utc ? last : zone.toUtc(last), { ...TIME, utc: true })
      : timeAt(last, TIME);
  // Only UNTIL is rewritten, in place, so the rule keeps the order and parts it was written with.
  if (formatTime(next) === formatTime(until)) return;
  const value = rrule.value.replace(/UNTIL=[^;]*/i, `UNTIL=${formatTime(next)}`);
  setProp(event, "RRULE", { name: "RRULE", params: rrule.params, value });
}

/**
 * The reminder the editor can show: minutes before the start for one simple alarm, null for none,
 * undefined when the alarms are more than one reminder can say (they are then kept as they are).
 * @param {Component} event
 */
export function reminderOf(event) {
  const alarms = event.components.filter((c) => c.name === "VALARM");
  if (alarms.length === 0) return null;
  const [alarm] = alarms;
  if (alarms.length > 1 || !alarm) return undefined;
  const action = prop(alarm, "ACTION")?.value.toUpperCase();
  const trigger = prop(alarm, "TRIGGER");
  if ((action !== "DISPLAY" && action !== "AUDIO") || !trigger) return undefined;
  if (trigger.params.VALUE?.[0] === "DATE-TIME" || trigger.params.RELATED?.[0] === "END")
    return undefined;
  if (prop(alarm, "REPEAT")) return undefined;
  const duration = parseDuration(trigger.value);
  if (!duration) return undefined;
  const { nominal, exact } = durationParts(duration);
  return -(nominal + exact) / 60_000;
}

/**
 * Replace the alarms with one display alarm `minutes` before the start, or none.
 * @param {Component} event
 * @param {number | null} minutes
 * @param {string} title
 */
export function setReminder(event, minutes, title) {
  event.components = event.components.filter((c) => c.name !== "VALARM");
  if (minutes === null) return;
  const trigger = formatDuration(durationOf(-minutes * 60_000));
  event.components.push({
    name: "VALARM",
    props: [
      { name: "ACTION", params: {}, value: "DISPLAY" },
      { name: "DESCRIPTION", params: {}, value: escapeText(title || "Reminder") },
      { name: "TRIGGER", params: {}, value: trigger },
    ],
    components: [],
  });
}

/**
 * Make sure a calendar can be read by others: VERSION and PRODID (§3.7), and a VTIMEZONE for every
 * IANA TZID its events use (§3.6.5). Existing VTIMEZONEs are kept.
 * @param {Component} calendar
 */
export function complete(calendar) {
  if (!prop(calendar, "PRODID"))
    calendar.props.unshift({ name: "PRODID", params: {}, value: PRODID });
  if (!prop(calendar, "VERSION"))
    calendar.props.unshift({ name: "VERSION", params: {}, value: "2.0" });
  const defined = new Set(
    calendar.components.filter((c) => c.name === "VTIMEZONE").map((c) => prop(c, "TZID")?.value),
  );
  /** @type {Map<string, number>} */
  const used = new Map();
  const visit = (/** @type {Component} */ component) => {
    for (const p of component.props) {
      const tzid = p.params.TZID?.[0];
      const year = Number(p.value.slice(0, 4));
      if (tzid && !defined.has(tzid) && Number.isFinite(year))
        used.set(tzid, Math.min(used.get(tzid) ?? year, year));
    }
    component.components.forEach(visit);
  };
  calendar.components.forEach(visit);
  const zones = [...used].flatMap(([tzid, year]) => {
    const zone = tzid === "UTC" ? undefined : ianaZone(tzid);
    return zone ? [vtimezoneFor(zone, Math.max(1970, year), tzid)] : [];
  });
  calendar.components.unshift(...zones);
}
