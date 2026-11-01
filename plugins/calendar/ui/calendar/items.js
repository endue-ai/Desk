// Occurrences as the desk's items (specs/item/v0, kind `event`), so agents, Eris and views read a
// calendar file the way they read any connected calendar, and the overlaps among them: two busy
// events at the same time (first-run scene 7, "Two of tomorrow's meetings overlap").
import { param, prop, props, text } from "../ical/component.js";
import { splitList, unescapeText } from "../ical/lines.js";
import { parseTime, rfc3339, wallOf } from "../ical/values.js";

/**
 * @typedef {import("./model.js").Occurrence} Occurrence
 * @typedef {import("./model.js").Model} Model
 * @typedef {{ connector: string, instance: string }} Source
 * @typedef {{ name?: string, email?: string }} PersonRef
 * @typedef {{ a: Occurrence, b: Occurrence, from: number, to: number }} Conflict
 */

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const LINK = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;

/**
 * A person a CAL-ADDRESS property names: CN as the name, a mailto: address as the email.
 * @param {import("../ical/lines.js").Prop} p
 * @returns {PersonRef | undefined}
 */
function person(p) {
  const name = param(p, "CN")?.trim();
  const address = p.value.trim().replace(/^mailto:/i, "");
  const email = EMAIL.test(address) ? address : undefined;
  if (!name && !email) return undefined;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

/** A UTC DATE-TIME property as RFC 3339, or undefined. */
const stamped = (
  /** @type {import("../ical/component.js").Component} */ c,
  /** @type {string} */ name,
) => {
  const value = parseTime(prop(c, name)?.value ?? "");
  return value && !value.date && value.utc ? rfc3339(wallOf(value), 0) : undefined;
};

/**
 * The instance name an item source takes from a file or calendar name: lowercase letters, digits,
 * - and _, 64 at most.
 * @param {string} name
 */
export function instanceName(name) {
  const slug = name
    .toLowerCase()
    .replace(/\.(ics|ical|ifb)$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 64);
  return slug || "default";
}

/**
 * One occurrence as an event item.
 * @param {Occurrence} occ
 * @param {Model} model
 * @param {Source} source
 */
export function toItem(occ, model, source) {
  const c = occ.event.component;
  const series = occ.master?.component ?? c;
  const zone = occ.allDay ? model.display : occ.event.zone;
  const at = (/** @type {number} */ utc) => rfc3339(utc, zone.offset(utc));
  const updatedAt =
    stamped(c, "LAST-MODIFIED") ?? stamped(c, "DTSTAMP") ?? stamped(c, "CREATED") ?? at(occ.start);
  const createdAt = stamped(c, "CREATED");
  const attendees = props(c, "ATTENDEE").flatMap((p) => person(p) ?? []);
  const organizer = prop(c, "ORGANIZER");
  const url = prop(c, "URL")?.value.trim();
  const rule = occ.recurring ? prop(series, "RRULE")?.value : undefined;
  const categories = props(c, "CATEGORIES")
    .flatMap((p) => splitList(p.value).map((v) => unescapeText(v).trim()))
    .filter(Boolean);
  const sequence = Number(prop(c, "SEQUENCE")?.value);
  return {
    id: occ.id.slice(0, 512),
    source,
    kind: /** @type {const} */ ("event"),
    title: occ.title.slice(0, 1000),
    updatedAt,
    ...(createdAt ? { createdAt } : {}),
    ...(url && LINK.test(url) ? { deepLink: url } : {}),
    ...(occ.description ? { body: occ.description } : {}),
    start: at(occ.start),
    end: at(occ.end),
    ...(occ.allDay ? { allDay: true } : {}),
    ...(occ.location ? { location: occ.location } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(rule ? { recurrence: rule } : {}),
    calendar: model.name,
    raw: {
      uid: occ.uid,
      ...(occ.instance ? { recurrenceId: occ.instance } : {}),
      status: occ.status,
      busy: !occ.free,
      ...(Number.isFinite(sequence) ? { sequence } : {}),
      ...(organizer && person(organizer) ? { organizer: person(organizer) } : {}),
      ...(categories.length ? { categories } : {}),
      ...(text(c, "CLASS") ? { class: text(c, "CLASS") } : {}),
    },
  };
}

/**
 * Busy, timed, not cancelled occurrences that overlap, as pairs in start order.
 * @param {Occurrence[]} list
 * @returns {Conflict[]}
 */
export function conflicts(list) {
  const busy = list
    .filter((o) => !o.allDay && !o.free && o.status !== "CANCELLED" && o.end > o.start)
    .sort((x, y) => x.start - y.start || x.end - y.end);
  /** @type {Conflict[]} */
  const found = [];
  /** @type {Occurrence[]} */
  let open = [];
  for (const occ of busy) {
    open = open.filter((o) => o.end > occ.start);
    for (const other of open)
      found.push({ a: other, b: occ, from: occ.start, to: Math.min(other.end, occ.end) });
    open.push(occ);
  }
  return found;
}
