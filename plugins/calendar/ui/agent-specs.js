// What agents read of the calendar's agent commands (ADR 0088): each one's title, description and
// argument schema, as plugin.json declares them; agent.js answers them, and the tests compare the
// two, so the manifest and the code never drift. The agent's file save waits for review.

export const TIME = {
  type: "string",
  description:
    "RFC 3339 with an offset (2026-10-30T09:00:00+09:00), a local time (2026-10-30T09:00) or a date (2026-10-30)",
};
const SPAN = {
  from: { ...TIME, description: `${TIME.description}; today when absent` },
  to: { ...TIME, description: `${TIME.description}; seven days after from when absent` },
};
const CALENDAR = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  description: "An open calendar's file path or buffer ID",
};
/** What names one event: its item id and start, as endue.calendar.events answers them. */
const NAMED = {
  id: { type: "string", minLength: 1, maxLength: 512, description: "The event item's id" },
  start: { ...TIME, description: "The event item's start, as events answered it" },
  calendar: CALENDAR,
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
  "endue.calendar.show": {
    title: "Calendar: show a date or view",
    description: "Show a date or a Calendar view. An omitted date or view keeps the current one.",
    args: {
      type: "object",
      properties: {
        date: { type: "string", description: "A date in YYYY-MM-DD or a day such as today" },
        view: { type: "string", enum: ["month", "week", "day", "agenda"] },
      },
      additionalProperties: false,
    },
  },
  "endue.calendar.current": {
    title: "Calendar: read the current view",
    description:
      "Read the open calendar, view, date span and event in the editor. The span's to date is exclusive.",
    args: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
  },
  "endue.calendar.new": {
    title: "Calendar: new event",
    description:
      "Open a new event in the editor for review. Optional fields prefill it without changing or saving the calendar.",
    args: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          properties: { ...FIELDS, start: TIME },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  "endue.calendar.events": {
    title: "Calendar: list events",
    description:
      "Read events between from and to in the open calendars (or the default file) and visible system calendars as event items. File events give raw.path for editing. System events are read-only. text narrows their titles, places or notes.",
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
      "Find overlaps between busy events in open calendars and visible system calendars. Answers the events and when and for how long they overlap.",
    args: { type: "object", properties: SPAN, additionalProperties: false },
    result: {
      type: "object",
      properties: { timeZone: { type: "string" }, conflicts: { type: "array" } },
    },
    readOnly: true,
  },
  "endue.calendar.add": {
    title: "Calendar: add an event",
    description: `Add an event to the named open calendar, or the open or default calendar without a name. ${UNSAVED}`,
    args: {
      type: "object",
      properties: { title: FIELDS.title, start: TIME, ...FIELDS, calendar: CALENDAR },
      required: ["title", "start"],
      additionalProperties: false,
    },
    result: ITEM,
  },
  "endue.calendar.update": {
    title: "Calendar: change an event",
    description: `Change the named event in an open file. Give calendar if several files match. Given fields replace their old values, and newStart moves the event. Scope selects instances of a repeat. ${UNSAVED}`,
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
    description: `Remove the named event from an open calendar buffer. Give calendar if several files match. Scope selects instances of a repeat. ${UNSAVED}`,
    args: {
      type: "object",
      properties: NAMED,
      required: ["id", "start"],
      additionalProperties: false,
    },
    result: { type: "object", properties: { deleted: { type: "string" } } },
  },
  "endue.calendar.save": {
    title: "Calendar: save the calendar",
    description:
      "Save pending edits to the named calendar after review. Agents give its path or buffer ID and need write access. The desk keeps the previous file version. Answers the path or null when there are no edits.",
    args: { type: "object", properties: { calendar: CALENDAR }, additionalProperties: false },
    result: { type: "object", properties: { path: { type: ["string", "null"] } } },
    irreversible: true,
  },
};
