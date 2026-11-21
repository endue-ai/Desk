// What agents read of the calendar's agent commands (ADR 0088): each one's title, description and
// argument schema, as plugin.json declares them; agent.js answers them, and the tests compare the
// two, so the manifest and the code never drift. Reads are read-only; delete is irreversible.

export const TIME = {
  type: "string",
  description:
    "RFC 3339 with an offset (2026-10-30T09:00:00+09:00), a local time (2026-10-30T09:00) or a date (2026-10-30)",
};
const SPAN = {
  from: { ...TIME, description: `${TIME.description}; today when absent` },
  to: { ...TIME, description: `${TIME.description}; seven days after from when absent` },
};
/** What names one event: its item id and start, as endue.calendar.events answers them. */
const NAMED = {
  id: { type: "string", minLength: 1, maxLength: 512, description: "The event item's id" },
  start: { ...TIME, description: "The event item's start, as events answered it" },
  scope: {
    enum: ["one", "following", "all"],
    description:
      "For an instance of a repeating event: it alone, it and the later ones, or all; one when absent",
  },
};
/** What an event holds, for add and update. */
const FIELDS = {
  title: { type: "string", minLength: 1, maxLength: 1000 },
  end: { ...TIME, description: `${TIME.description}; the default length after start when absent` },
  allDay: { type: "boolean" },
  timeZone: {
    type: "string",
    description: "An IANA zone for local times; the person's zone when absent",
  },
  location: { type: "string", maxLength: 1000 },
  description: { type: "string", maxLength: 100000 },
  rrule: {
    type: "string",
    description: "An RFC 5545 RRULE value, FREQ=WEEKLY;BYDAY=MO; empty to stop repeating",
  },
  reminder: { type: "integer", description: "Minutes before the start" },
};
const UNSAVED = "The change is unsaved until the person saves or endue.calendar.save runs.";
const ITEM = { type: "object", properties: { item: { type: "object" } } };

/** @type {Record<string, { title: string, description: string, args: object, result?: object, readOnly?: true, irreversible?: true }>} */
export const SPECS = {
  "endue.calendar.events": {
    title: "Calendar: list events",
    description:
      "The events between from and to in the open calendars (or the default calendar file), as specs/item/v0 event items, earliest first: id, title, start, end, allDay, location, body, recurrence and raw.uid. text narrows to events whose title, place or notes hold it.",
    args: {
      type: "object",
      properties: {
        ...SPAN,
        text: {
          type: "string",
          description: "Only events whose title, place or notes hold this text",
        },
      },
      additionalProperties: false,
    },
    result: {
      type: "object",
      properties: { timeZone: { type: "string" }, items: { type: "array" } },
    },
    readOnly: true,
  },
  "endue.calendar.conflicts": {
    title: "Calendar: find overlapping events",
    description:
      "Pairs of busy events between from and to that overlap, with when the overlap starts and ends and for how many minutes.",
    args: { type: "object", properties: SPAN, additionalProperties: false },
    result: {
      type: "object",
      properties: { timeZone: { type: "string" }, conflicts: { type: "array" } },
    },
    readOnly: true,
  },
  "endue.calendar.add": {
    title: "Calendar: add an event",
    description: `Add an event to the calendar on screen (or the default calendar file) and answer it as an item. ${UNSAVED}`,
    args: {
      type: "object",
      properties: { title: FIELDS.title, start: TIME, ...FIELDS },
      required: ["title", "start"],
      additionalProperties: false,
    },
    result: ITEM,
  },
  "endue.calendar.update": {
    title: "Calendar: change an event",
    description: `Change an event of the calendar on screen: the fields given take the place of its own, the rest stay; newStart moves it. A repeating event changes as scope says. Answers it as an item. ${UNSAVED}`,
    args: {
      type: "object",
      properties: {
        ...NAMED,
        newStart: { ...TIME, description: "Where the event starts now" },
        ...FIELDS,
      },
      required: ["id", "start"],
      additionalProperties: false,
    },
    result: ITEM,
  },
  "endue.calendar.delete": {
    title: "Calendar: delete an event",
    description: `Delete an event of the calendar on screen, after the person says yes; a repeating event as scope says. ${UNSAVED}`,
    args: {
      type: "object",
      properties: NAMED,
      required: ["id", "start"],
      additionalProperties: false,
    },
    result: { type: "object", properties: { deleted: { type: "string" } } },
    irreversible: true,
  },
  "endue.calendar.save": {
    title: "Calendar: save the calendar",
    description:
      "Save the calendar on screen to its file, as the person's save does; the desk keeps what it replaced as a version. Answers the path, or null when nothing was unsaved.",
    args: { type: "object", properties: {}, additionalProperties: false },
    result: { type: "object", properties: { path: { type: ["string", "null"] } } },
  },
};
