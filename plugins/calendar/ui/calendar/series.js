// The instances of a series as the file names them: the instance keys of EXDATE, RDATE and
// RECURRENCE-ID values, the overrides of a series, and ending a series before one of its instances
// (UNTIL, §3.3.10), which "this and following" changes and deletions do.
import { prop, props, setProp } from "../ical/component.js";
import { splitList } from "../ical/lines.js";
import { expand } from "../ical/recur.js";
import { formatRule } from "../ical/rrule.js";
import { DAY, formatTime, parseTime, timeAt, wallOf } from "../ical/values.js";
import { instanceKey } from "./model.js";

/**
 * @typedef {import("../ical/component.js").Component} Component
 * @typedef {import("./model.js").EventInfo} EventInfo
 */

/** A UTC DATE-TIME, for UNTIL. */
const UTC_LIKE = /** @type {const} */ ({
  date: false,
  y: 0,
  m: 0,
  d: 0,
  h: 0,
  mi: 0,
  s: 0,
  utc: true,
});

/** The wall time, in the series' zone, of an instance key. */
export const keyWall = (/** @type {string} */ key, /** @type {EventInfo} */ series) => {
  const value = parseTime(key);
  if (!value) throw new Error(`Not an instance: ${key}`);
  const wall = wallOf(value);
  return value.date || !value.utc ? wall : wall + series.zone.offset(wall);
};

/**
 * Every instance value of EXDATE or RDATE, with its key, as written props of one value each.
 * @param {Component} component
 * @param {string} name
 * @param {EventInfo} series
 */
export const instanceValues = (component, name, series) =>
  props(component, name).flatMap((p) =>
    splitList(p.value).flatMap((part) => {
      const value = parseTime(part.split("/")[0] ?? "", p.params.TZID?.[0]);
      if (!value) return [];
      const zone = value.date ? series.zone : value.utc ? undefined : series.zones.get(value.tzid);
      const key = instanceKey(value, zone ?? series.zone);
      return [{ key, wall: keyWall(key, series), prop: { ...p, value: part } }];
    }),
  );

/**
 * End a series before the instance `key`: UNTIL just before it, written as DTSTART is (§3.3.10),
 * and COUNT turned into that UNTIL. Returns how many instances the rule made before it.
 * @param {Component} component
 * @param {EventInfo} series
 * @param {string} key
 */
export function endBefore(component, series, key) {
  const rule = series.rule;
  if (!rule) return 0;
  const split = keyWall(key, series);
  const start = wallOf(series.start);
  let before = 0;
  for (const wall of expand(rule, start, { end: split - 1 })) if (wall < split) before++;
  const last = series.start.date ? split - DAY : split - 1000;
  const { date, utc, tzid } = series.start;
  const until =
    date || (!utc && !tzid)
      ? timeAt(last, series.start)
      : timeAt(utc ? last : series.zone.toUtc(last), UTC_LIKE);
  const { count: _count, ...rest } = rule;
  setProp(component, "RRULE", {
    name: "RRULE",
    params: {},
    value: formatRule({ ...rest, until }, formatTime),
  });
  return before;
}

/** Drop the EXDATE and RDATE values at or after `key`, keeping the others. */
export function dropFrom(
  /** @type {Component} */ component,
  /** @type {EventInfo} */ series,
  /** @type {string} */ key,
) {
  for (const name of ["EXDATE", "RDATE"]) {
    const kept = instanceValues(component, name, series).filter((v) => v.key < key);
    setProp(
      component,
      name,
      kept.map((v) => v.prop),
    );
  }
}

/**
 * The overrides of a series in a calendar.
 * @param {Component} calendar
 * @param {string} uid
 */
export const overridesOf = (calendar, uid) =>
  calendar.components.filter(
    (c) => c.name === "VEVENT" && prop(c, "UID")?.value.trim() === uid && prop(c, "RECURRENCE-ID"),
  );

/** The instance key of an override component. */
export const overrideKey = (/** @type {Component} */ override, /** @type {EventInfo} */ series) => {
  const p = prop(override, "RECURRENCE-ID");
  const value = p && parseTime(p.value, p.params.TZID?.[0]);
  if (!value) return "";
  return instanceKey(value, value.utc || value.date ? series.zone : series.zones.get(value.tzid));
};
