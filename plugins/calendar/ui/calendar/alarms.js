// Reminders (VALARM, RFC 5545 §3.6.6): when each alarm of each occurrence is due. DISPLAY and AUDIO
// alarms remind on the desk; EMAIL and PROCEDURE alarms are another app's to send. TRIGGER is a
// duration from the start (or the end with RELATED=END) or a UTC time (VALUE=DATE-TIME); REPEAT adds
// copies DURATION apart. An alarm ACKNOWLEDGED at or after its time (RFC 9074) is not due again.
import { param, prop, text } from "../ical/component.js";
import { DAY, durationParts, parseDuration, parseTime, wallOf } from "../ical/values.js";
import { occurrences } from "./model.js";

/**
 * @typedef {import("./model.js").Model} Model
 * @typedef {import("./model.js").Occurrence} Occurrence
 * @typedef {{ key: string, at: number, occurrence: Occurrence, message: string }} Reminder
 */

/** How far before or after an event an alarm is looked for. */
const REACH = 8 * DAY;

/**
 * The times one VALARM is due for one occurrence.
 * @param {import("../ical/component.js").Component} alarm
 * @param {Occurrence} occ
 * @returns {number[]}
 */
function times(alarm, occ) {
  const trigger = prop(alarm, "TRIGGER");
  if (!trigger) return [];
  /** @type {number | undefined} */
  let first;
  if (param(trigger, "VALUE") === "DATE-TIME") {
    const value = parseTime(trigger.value);
    if (value && !value.date && value.utc) first = wallOf(value);
  } else {
    const duration = parseDuration(trigger.value);
    if (duration) {
      const { nominal, exact } = durationParts(duration);
      first = (param(trigger, "RELATED") === "END" ? occ.end : occ.start) + nominal + exact;
    }
  }
  if (first === undefined) return [];
  const repeat = Number(prop(alarm, "REPEAT")?.value ?? "0");
  const gap = parseDuration(prop(alarm, "DURATION")?.value ?? "");
  const out = [first];
  if (gap && Number.isInteger(repeat) && repeat > 0) {
    const { nominal, exact } = durationParts(gap);
    for (let i = 1; i <= Math.min(repeat, 100); i++) out.push(first + i * (nominal + exact));
  }
  const acknowledged = parseTime(prop(alarm, "ACKNOWLEDGED")?.value ?? "");
  const seen = acknowledged && !acknowledged.date ? wallOf(acknowledged) : -Infinity;
  return out.filter((at) => at > seen);
}

/**
 * The reminders due in [from, to), earliest first.
 * @param {Model} model
 * @param {number} from
 * @param {number} to
 * @returns {Reminder[]}
 */
export function dueReminders(model, from, to) {
  /** @type {Reminder[]} */
  const due = [];
  for (const occ of occurrences(model, from - REACH, to + REACH)) {
    if (occ.status === "CANCELLED") continue;
    occ.event.component.components.forEach((alarm, index) => {
      if (alarm.name !== "VALARM") return;
      const action = prop(alarm, "ACTION")?.value.trim().toUpperCase();
      if (action !== "DISPLAY" && action !== "AUDIO") return;
      const message = text(alarm, "DESCRIPTION")?.trim() || occ.title;
      for (const at of times(alarm, occ))
        if (at >= from && at < to)
          due.push({ key: `${occ.id}|${index}|${at}`, at, occurrence: occ, message });
    });
  }
  return due.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}
