// Changing a calendar: new events, and changes and deletions of a single event, of one instance of a
// series (an override with RECURRENCE-ID, or an EXDATE), of the instances from one on (the series
// ends with UNTIL and a new series with its own UID takes over), or of the whole series. Every
// operation works on a copy of the document and returns the copy.
import { clone, prop, setProp, text } from "../ical/component.js";
import { formatRule } from "../ical/rrule.js";
import { DAY, formatTime, wallOf } from "../ical/values.js";
import { ianaZone } from "../ical/zones.js";
import { instanceKey } from "./model.js";
import {
  dropFrom,
  endBefore,
  instanceValues,
  keyWall,
  overrideKey,
  overridesOf,
} from "./series.js";
import {
  complete,
  instanceProp,
  PRODID,
  reminderOf,
  setText,
  stamp,
  timeProp,
  touch,
  writeFields,
} from "./write.js";

/**
 * @typedef {import("../ical/component.js").Component} Component
 * @typedef {import("../ical/component.js").Document} Document
 * @typedef {import("./model.js").Occurrence} Occurrence
 * @typedef {import("./model.js").EventInfo} EventInfo
 * @typedef {import("./write.js").EventFields} EventFields
 * @typedef {import("../ical/zones.js").Zone} Zone
 * @typedef {"one" | "following" | "all"} Scope
 * @typedef {{ now: number, uid: () => string, display: Zone }} Context
 */

/**
 * An empty calendar.
 * @param {string} [name]
 * @returns {Document}
 */
export function emptyDocument(name) {
  const props = [
    { name: "VERSION", params: {}, value: "2.0" },
    { name: "PRODID", params: {}, value: PRODID },
    { name: "CALSCALE", params: {}, value: "GREGORIAN" },
  ];
  /** @type {Component} */
  const calendar = { name: "VCALENDAR", props, components: [] };
  if (name) setText(calendar, "X-WR-CALNAME", name);
  return { calendars: [calendar], problems: [] };
}

/**
 * What the editor shows for an occurrence: its times in the zone it was written in (a recurring
 * series in UTC stays in UTC; a single UTC event or a zone only its VTIMEZONE defines is shown in
 * the display zone), its text, its rule, its reminder.
 * @param {Occurrence} occ
 * @param {Zone} display
 * @returns {EventFields}
 */
export function fieldsOf(occ, display) {
  const event = occ.event;
  const series = occ.master ?? event;
  const start = series.start;
  const zone = occ.allDay
    ? ""
    : start.utc
      ? occ.recurring
        ? "UTC"
        : display.id
      : start.tzid
        ? ianaZone(event.zone.id)
          ? event.zone.id
          : display.id
        : "";
  const shown = zone === "UTC" ? 0 : zone ? (ianaZone(zone) ?? display) : event.zone;
  const wall = (/** @type {number} */ at) =>
    occ.allDay ? at : at + (typeof shown === "number" ? 0 : shown.offset(at));
  const rule = prop(series.component, "RRULE")?.value;
  const reminder = reminderOf(event.component);
  return {
    title: occ.title,
    allDay: occ.allDay,
    start: occ.allDay ? occ.startWall : wall(occ.start),
    end: occ.allDay ? occ.endWall : wall(occ.end),
    zone,
    location: occ.location ?? "",
    description: occ.description ?? "",
    rrule: rule ?? null,
    ...(reminder !== undefined ? { reminder } : {}),
    free: occ.free,
  };
}

/** Whether the editor moved an event: its times, its zone or all-day. */
const moves = (/** @type {EventFields} */ before, /** @type {EventFields} */ after) =>
  before.allDay !== after.allDay ||
  before.start !== after.start ||
  before.end !== after.end ||
  before.zone !== after.zone;

/** The copy of a component of `doc` in `copy`, found by position. */
const twin = (
  /** @type {Document} */ doc,
  /** @type {Document} */ copy,
  /** @type {EventInfo} */ info,
) => {
  const c = doc.calendars.indexOf(info.calendar);
  const calendar = copy.calendars[c];
  const component = calendar?.components[info.calendar.components.indexOf(info.component)];
  if (!calendar || !component) throw new Error("The event is no longer in the calendar.");
  return { calendar, component };
};

/**
 * Add an event to the first calendar of the file.
 * @param {Document} doc
 * @param {EventFields} fields
 * @param {Context} context
 */
export function createEvent(doc, fields, { now, uid }) {
  const copy = doc.calendars.length ? clone(doc) : emptyDocument();
  const calendar = /** @type {Component} */ (copy.calendars[0]);
  const id = uid();
  /** @type {Component} */
  const event = {
    name: "VEVENT",
    props: [
      { name: "UID", params: {}, value: id },
      stamp("DTSTAMP", now),
      stamp("CREATED", now),
      stamp("LAST-MODIFIED", now),
      { name: "SEQUENCE", params: {}, value: "0" },
    ],
    components: [],
  };
  writeFields(event, fields);
  calendar.components.push(event);
  complete(calendar);
  return { doc: copy, uid: id };
}

/**
 * Change an event, one instance of it, the instances from one on, or all of them.
 * @param {Document} doc
 * @param {Occurrence} occ
 * @param {EventFields} fields
 * @param {Scope} scope
 * @param {Context} context
 * @returns {Document}
 */
export function updateEvent(doc, occ, fields, scope, context) {
  const copy = clone(doc);
  const series = occ.master;
  const inSeries = Boolean(occ.recurring && series && occ.instance);
  const initial = fieldsOf(occ, context.display);
  const times = moves(initial, fields);
  if (!inSeries || !series || !occ.instance) {
    const { calendar, component } = twin(doc, copy, occ.event);
    touch(component, context.now, writeFields(component, fields, { times }));
    complete(calendar);
    return copy;
  }
  const first = instanceKey(series.start, series.zone);
  const effective = scope === "following" && occ.instance === first ? "all" : scope;
  const { calendar, component: master } = twin(doc, copy, series);

  if (effective === "one") {
    const existing = occ.event !== series ? twin(doc, copy, occ.event).component : undefined;
    const override = existing ?? clone(master);
    if (!existing) {
      for (const name of ["RRULE", "RDATE", "EXDATE"]) setProp(override, name, undefined);
      setProp(
        override,
        "RECURRENCE-ID",
        instanceProp("RECURRENCE-ID", occ.instance, series.start, series.zone),
      );
      calendar.components.splice(calendar.components.indexOf(master) + 1, 0, override);
    }
    // A new override needs its own times: it starts as a copy of the series' first instance.
    const written = writeFields(
      override,
      { ...fields, rrule: null },
      { times: times || !existing },
    );
    touch(override, context.now, written);
    complete(calendar);
    return copy;
  }

  const delta = fields.start - initial.start;
  const length = fields.end - fields.start;
  /** A wall time of the old series moved as the occurrence moved, in the new kind. */
  const moved = (/** @type {number} */ wall) => {
    const shifted = wall + delta;
    return fields.allDay ? Math.floor(shifted / DAY) * DAY : shifted;
  };
  /**
   * Instance values (EXDATE, RDATE) moved, in the new kind.
   * @param {Array<{ wall: number, prop: import("../ical/lines.js").Prop }>} values
   */
  const rewrite = (values) =>
    values.map((v) => timeProp(v.prop.name, moved(v.wall), fields.allDay, fields.zone));
  const recurrenceAt = (/** @type {number} */ wall) =>
    timeProp("RECURRENCE-ID", moved(wall), fields.allDay, fields.zone);

  if (effective === "following") {
    const target = clone(master);
    const exdates = instanceValues(master, "EXDATE", series).filter((v) => v.key >= occ.instance);
    const rdates = instanceValues(master, "RDATE", series).filter((v) => v.key >= occ.instance);
    const before = endBefore(master, series, occ.instance);
    dropFrom(master, series, occ.instance);
    touch(master, context.now, true);
    const uid = context.uid();
    setProp(target, "UID", { name: "UID", params: {}, value: uid });
    setProp(target, "SEQUENCE", { name: "SEQUENCE", params: {}, value: "0" });
    setProp(target, "CREATED", stamp("CREATED", context.now));
    // The new series makes the instances the old one had left: COUNT goes down by those it kept.
    const count = series.rule?.count;
    const kept =
      series.rule && count !== undefined
        ? formatRule({ ...series.rule, count: Math.max(1, count - before) }, formatTime)
        : prop(master, "RRULE") && series.rule
          ? formatRule({ ...series.rule }, formatTime)
          : null;
    // The rule as it was (the editor hands it back unchanged) keeps the count the split left.
    const unchanged =
      fields.rrule === undefined || fields.rrule === prop(series.component, "RRULE")?.value;
    writeFields(target, { ...fields, rrule: unchanged ? kept : fields.rrule });
    setProp(target, "EXDATE", rewrite(exdates));
    setProp(target, "RDATE", rewrite(rdates));
    calendar.components.splice(calendar.components.indexOf(master) + 1, 0, target);
    for (const override of overridesOf(calendar, series.uid)) {
      const key = overrideKey(override, series);
      if (key < occ.instance) continue;
      setProp(override, "UID", { name: "UID", params: {}, value: uid });
      setProp(override, "RECURRENCE-ID", recurrenceAt(keyWall(key, series)));
    }
    complete(calendar);
    return copy;
  }

  // The whole series. Text that overrides shared with the series follows it.
  const old = {
    SUMMARY: text(master, "SUMMARY"),
    LOCATION: text(master, "LOCATION"),
    DESCRIPTION: text(master, "DESCRIPTION"),
  };
  if (fields.rrule === null) {
    // No longer a series: one event at the time the person chose.
    for (const name of ["RDATE", "EXDATE"]) setProp(master, name, undefined);
    for (const override of overridesOf(calendar, series.uid))
      calendar.components.splice(calendar.components.indexOf(override), 1);
    writeFields(master, fields);
    touch(master, context.now, true);
    complete(calendar);
    return copy;
  }
  // Unmoved, the series keeps DTSTART, EXDATE, RDATE and RECURRENCE-ID as written.
  if (times)
    for (const name of ["EXDATE", "RDATE"])
      setProp(master, name, rewrite(instanceValues(master, name, series)));
  const start = moved(wallOf(series.start));
  const significant = writeFields(master, { ...fields, start, end: start + length }, { times });
  touch(master, context.now, significant);
  for (const override of overridesOf(calendar, series.uid)) {
    if (times) {
      const key = overrideKey(override, series);
      setProp(override, "RECURRENCE-ID", recurrenceAt(keyWall(key, series)));
    }
    const next = {
      SUMMARY: fields.title,
      LOCATION: fields.location,
      DESCRIPTION: fields.description,
    };
    for (const [name, value] of Object.entries(next)) {
      const before = old[/** @type {keyof typeof old} */ (name)];
      if (value !== undefined && text(override, name) === before) setText(override, name, value);
    }
  }
  complete(calendar);
  return copy;
}

/**
 * Delete an event, one instance of it, the instances from one on, or all of them.
 * @param {Document} doc
 * @param {Occurrence} occ
 * @param {Scope} scope
 * @param {Context} context
 * @returns {Document}
 */
export function deleteEvent(doc, occ, scope, context) {
  const copy = clone(doc);
  const series = occ.master;
  const { calendar, component } = twin(doc, copy, occ.event);
  const remove = (/** @type {Component} */ c) =>
    calendar.components.splice(calendar.components.indexOf(c), 1);
  if (!occ.recurring || !series || !occ.instance) {
    // A single event takes any stray overrides of its UID with it; a lone override goes alone.
    const strays = occ.event === series ? overridesOf(calendar, series.uid) : [];
    for (const c of [component, ...strays]) remove(c);
    return copy;
  }
  const master = twin(doc, copy, series).component;
  const first = instanceKey(series.start, series.zone);
  if (scope === "all" || (scope === "following" && occ.instance === first)) {
    for (const override of overridesOf(calendar, series.uid)) remove(override);
    remove(master);
    return copy;
  }
  if (scope === "one") {
    if (component !== master) remove(component);
    master.props.push(instanceProp("EXDATE", occ.instance, series.start, series.zone));
    touch(master, context.now, true);
    return copy;
  }
  endBefore(master, series, occ.instance);
  dropFrom(master, series, occ.instance);
  for (const override of overridesOf(calendar, series.uid))
    if (overrideKey(override, series) >= occ.instance) remove(override);
  touch(master, context.now, true);
  return copy;
}
