// Meeting invitations the way mail carries them: iTIP (RFC 5546) objects in a text/calendar part
// (iMIP, RFC 6047). Reading turns the VEVENTs of a REQUEST, CANCEL, REPLY, PUBLISH or ADD into
// invitations the reader shows; replying writes the METHOD:REPLY object an organizer's software
// expects, with the one ATTENDEE that answered. Nothing here touches the DOM or the bridge.
import { children, param, parse, prop, props, serialize, text } from "./component.js";
import { escapeText } from "./lines.js";
import {
  DAY,
  formatTime,
  localZone,
  parseDuration,
  parseOffset,
  parseTime,
  resolveZone,
  utcValue,
  whenOf,
} from "./values.js";

/**
 * @typedef {import("./component.js").Component} Component
 * @typedef {import("./lines.js").Prop} Prop
 * @typedef {import("./values.js").When} When
 * @typedef {"NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE" | "DELEGATED"} PartStat
 * @typedef {{ name?: string, email?: string }} PersonRef
 * @typedef {PersonRef & { partstat: PartStat, role?: string, rsvp: boolean }} Attendee
 * @typedef {{
 *   method?: string, uid: string, recurrenceId?: string, sequence: number, dtstamp?: number,
 *   summary: string, description?: string, location?: string, url?: string,
 *   start: When, end: When, allDay: boolean, organizer?: PersonRef, attendees: Attendee[],
 *   status: "CONFIRMED" | "TENTATIVE" | "CANCELLED", rrule?: string, exceptions: number,
 *   component: Component, timezones: Component[],
 * }} Invitation
 * One VEVENT of an iTIP message, read. `component` and `timezones` are what was received, kept so
 * a reply can echo the organizer's own values.
 * @typedef {{ method?: string, invitations: Invitation[], problems: string[] }} Reading
 */

export const PRODID = "-//endue//Desk Mail 0.1//EN";
export const METHODS = [
  "REQUEST",
  "CANCEL",
  "REPLY",
  "PUBLISH",
  "ADD",
  "COUNTER",
  "DECLINECOUNTER",
];
/** The answers a person gives an invitation, and the words that go with each (RFC 6047 §4.2). */
export const ANSWERS = /** @type {const} */ ({
  ACCEPTED: { verb: "accepted", subject: "Accepted" },
  TENTATIVE: { verb: "tentatively accepted", subject: "Tentative" },
  DECLINED: { verb: "declined", subject: "Declined" },
});

const EMAIL = /^[^@\s]+@[^@\s]+$/;

/**
 * The person a CAL-ADDRESS property names: CN as the name, a mailto: address as the email.
 * @param {Prop} p
 * @returns {PersonRef | undefined}
 */
export function personOf(p) {
  const name = param(p, "CN")?.trim();
  const address = p.value.trim().replace(/^mailto:/i, "");
  const email = EMAIL.test(address) ? address.toLowerCase() : undefined;
  if (!name && !email) return undefined;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

/** @param {Prop} p @returns {Attendee | undefined} */
function attendeeOf(p) {
  const person = personOf(p);
  if (!person) return undefined;
  const stat = (param(p, "PARTSTAT") ?? "NEEDS-ACTION").toUpperCase();
  const partstat = /** @type {PartStat} */ (
    ["ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"].includes(stat) ? stat : "NEEDS-ACTION"
  );
  const role = param(p, "ROLE")?.toUpperCase();
  return {
    ...person,
    partstat,
    ...(role ? { role } : {}),
    rsvp: (param(p, "RSVP") ?? "FALSE").toUpperCase() === "TRUE",
  };
}

/**
 * What a VTIMEZONE says about its zone, for TZIDs the Intl API does not know.
 * @param {Component} tz
 */
function timezoneOf(tz) {
  const tzid = prop(tz, "TZID")?.value.trim();
  if (!tzid) return undefined;
  const location = text(tz, "X-LIC-LOCATION");
  const standard = children(tz, "STANDARD")[0] ?? tz.components[0];
  const offset = standard ? parseOffset(prop(standard, "TZOFFSETTO")?.value ?? "") : undefined;
  return {
    tzid,
    ...(location ? { location } : {}),
    ...(offset === undefined ? {} : { standardOffset: offset }),
  };
}

/**
 * Read one VEVENT. `problems` collects what could not be read; a VEVENT without a start is skipped.
 * @param {Component} event
 * @param {Component[]} timezones
 * @param {string | undefined} method
 * @param {string} local
 * @param {string[]} problems
 * @returns {Invitation | undefined}
 */
function invitationOf(event, timezones, method, local, problems) {
  const zones = timezones.flatMap((tz) => timezoneOf(tz) ?? []);
  const zoneOf = (/** @type {string} */ tzid) => resolveZone(tzid, zones);
  const uid = prop(event, "UID")?.value.trim();
  const dtstart = prop(event, "DTSTART");
  const startValue = dtstart ? parseTime(dtstart.value, param(dtstart, "TZID")) : undefined;
  if (!uid || !dtstart || !startValue) {
    problems.push(uid ? `${uid} has no readable DTSTART.` : "A VEVENT has no UID.");
    return undefined;
  }
  const start = whenOf(startValue, zoneOf, local);
  const dtend = prop(event, "DTEND");
  const endValue = dtend
    ? parseTime(dtend.value, param(dtend, "TZID") ?? startValue.tzid)
    : undefined;
  const duration = parseDuration(prop(event, "DURATION")?.value ?? "");
  /** @type {When} */
  let end;
  if (endValue) end = whenOf(endValue, zoneOf, local);
  else {
    // No end: the duration, or, as §3.6.1 says, the day for a date and the same instant for a time.
    const span = duration ?? (startValue.date ? DAY : 0);
    const shifted = { ...startValue };
    const wall = whenOf(shifted, zoneOf, local).wall + span;
    end = { ...start, wall, ...(start.utc === undefined ? {} : { utc: start.utc + span }) };
  }
  if (end.wall < start.wall) {
    problems.push(`${uid} ends before it starts.`);
    end = start;
  }
  const sequence = Number(prop(event, "SEQUENCE")?.value ?? "0");
  const stampValue = parseTime(prop(event, "DTSTAMP")?.value ?? "");
  const stamp = stampValue && !stampValue.date ? whenOf(stampValue, zoneOf, local).utc : undefined;
  const organizer = prop(event, "ORGANIZER");
  const statusText = (text(event, "STATUS") ?? "").toUpperCase();
  const status = /** @type {Invitation["status"]} */ (
    method === "CANCEL" || statusText === "CANCELLED"
      ? "CANCELLED"
      : statusText === "TENTATIVE"
        ? "TENTATIVE"
        : "CONFIRMED"
  );
  const recurrenceId = prop(event, "RECURRENCE-ID")?.value.trim();
  const rrule = prop(event, "RRULE")?.value.trim();
  const url = text(event, "URL");
  return {
    ...(method ? { method } : {}),
    uid,
    ...(recurrenceId ? { recurrenceId } : {}),
    sequence: Number.isFinite(sequence) ? sequence : 0,
    ...(stamp === undefined ? {} : { dtstamp: stamp }),
    summary: text(event, "SUMMARY") ?? "(No title)",
    ...(text(event, "DESCRIPTION") ? { description: text(event, "DESCRIPTION") } : {}),
    ...(text(event, "LOCATION") ? { location: text(event, "LOCATION") } : {}),
    ...(url ? { url } : {}),
    start,
    end,
    allDay: startValue.date,
    ...(organizer && personOf(organizer) ? { organizer: personOf(organizer) } : {}),
    attendees: props(event, "ATTENDEE").flatMap((p) => attendeeOf(p) ?? []),
    status,
    ...(rrule ? { rrule } : {}),
    exceptions: props(event, "EXDATE").length,
    component: event,
    timezones,
  };
}

/**
 * Read a text/calendar part: its method and every VEVENT as an invitation. Never throws.
 * @param {string} ics
 * @param {string} [local] the person's zone; the one this code runs in when absent
 * @returns {Reading}
 */
export function readCalendar(ics, local = localZone()) {
  const { calendars, problems } = parse(ics);
  const said = problems.map((p) => p.message);
  /** @type {Invitation[]} */
  const invitations = [];
  /** @type {string | undefined} */
  let method;
  for (const calendar of calendars) {
    const own = prop(calendar, "METHOD")?.value.trim().toUpperCase();
    if (own) method = method ?? own;
    const timezones = children(calendar, "VTIMEZONE");
    for (const event of children(calendar, "VEVENT")) {
      const read = invitationOf(event, timezones, own, local, said);
      if (read) invitations.push(read);
    }
  }
  if (calendars.length === 0) said.push("The calendar part holds no VCALENDAR.");
  return { ...(method ? { method } : {}), invitations, problems: said };
}

/**
 * The attendee that is the person, by their addresses; undefined when none of them is invited.
 * @param {Invitation} invitation
 * @param {string[]} addresses
 */
export function myAttendee(invitation, addresses) {
  const mine = new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  return invitation.attendees.find((a) => a.email !== undefined && mine.has(a.email));
}

/**
 * Whether `next` is a newer revision of the same event than `before` (RFC 5546 §2.1.5: the
 * SEQUENCE first, then DTSTAMP).
 * @param {Invitation} before
 * @param {Invitation} next
 */
export function supersedes(before, next) {
  if (next.uid !== before.uid || next.recurrenceId !== before.recurrenceId) return false;
  if (next.sequence !== before.sequence) return next.sequence > before.sequence;
  return (next.dtstamp ?? 0) > (before.dtstamp ?? 0);
}

/**
 * The METHOD:REPLY object for one attendee's answer (RFC 5546 §3.2.3): UID, SEQUENCE and
 * RECURRENCE-ID echoed, DTSTAMP now, the ORGANIZER, the one ATTENDEE with its PARTSTAT, and the
 * SUMMARY, DTSTART and DTEND the organizer wrote, with the VTIMEZONEs they need.
 * @param {Invitation} invitation
 * @param {Attendee | PersonRef} attendee the person, as the organizer addressed them
 * @param {keyof typeof ANSWERS} partstat
 * @param {number} now
 */
export function replyCalendar(invitation, attendee, partstat, now) {
  if (!attendee.email) throw new Error("An answer needs the attendee's email address.");
  const organizer = prop(invitation.component, "ORGANIZER");
  if (!organizer) throw new Error("The invitation names no organizer to answer.");
  const copied = ["DTSTART", "DTEND", "RECURRENCE-ID", "SUMMARY"].flatMap(
    (name) => prop(invitation.component, name) ?? [],
  );
  const tzids = new Set(copied.flatMap((p) => p.params.TZID ?? []));
  /** @type {Prop[]} */
  const eventProps = [
    { name: "UID", params: {}, value: invitation.uid },
    { name: "SEQUENCE", params: {}, value: String(invitation.sequence) },
    { name: "DTSTAMP", params: {}, value: formatTime(utcValue(now)) },
    { name: "ORGANIZER", params: { ...organizer.params }, value: organizer.value },
    {
      name: "ATTENDEE",
      params: { ...(attendee.name ? { CN: [attendee.name] } : {}), PARTSTAT: [partstat] },
      value: `mailto:${attendee.email}`,
    },
    ...copied,
  ];
  /** @type {Component} */
  const calendar = {
    name: "VCALENDAR",
    props: [
      { name: "VERSION", params: {}, value: "2.0" },
      { name: "PRODID", params: {}, value: PRODID },
      { name: "METHOD", params: {}, value: "REPLY" },
    ],
    components: [
      ...invitation.timezones.filter((tz) => tzids.has(prop(tz, "TZID")?.value.trim() ?? "")),
      { name: "VEVENT", props: eventProps, components: [] },
    ],
  };
  return serialize(calendar);
}

/**
 * The subject line of an answer: "Accepted: Design review".
 * @param {keyof typeof ANSWERS} partstat
 * @param {Invitation} invitation
 */
export const replySubject = (partstat, invitation) =>
  `${ANSWERS[partstat].subject}: ${invitation.summary}`;

/**
 * One sentence for the body of an answer, so a reader without calendar software still knows.
 * @param {PersonRef} attendee
 * @param {keyof typeof ANSWERS} partstat
 * @param {Invitation} invitation
 */
export const replyBody = (attendee, partstat, invitation) =>
  `${attendee.name ?? attendee.email ?? "The attendee"} has ${ANSWERS[partstat].verb} the invitation: ${invitation.summary}.`;

/** The TEXT value of a sentence, for a COMMENT or DESCRIPTION. @param {string} words */
export const asText = (words) => escapeText(words);
