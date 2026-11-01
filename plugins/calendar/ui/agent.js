// Commands for agents, Eris and other plugins: the events of a time span as specs/item/v0 items, the
// busy events that overlap, and adding an event. They are registered with cmd.register and an argument
// schema, so callers see what to send; every action goes through the command registry (ADR 0032).
// Reads cover the open calendars, or the calendar file the settings name when none is open.
import { createEvent } from "./calendar/edit.js";
import { conflicts, instanceName, toItem } from "./calendar/items.js";
import { occurrences } from "./calendar/model.js";
import { parseRule } from "./ical/rrule.js";
import { DAY, MINUTE } from "./ical/values.js";
import { ianaZone } from "./ical/zones.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./calendar.js").Cal} Cal
 * @typedef {import("./ical/zones.js").Zone} Zone
 * @typedef {import("./ical/component.js").Document} Document
 */

const PLUGIN = "endue.calendar";
/** The longest span one call reads. */
const MAX_DAYS = 366;

const TIME = {
  type: "string",
  description:
    "RFC 3339 with an offset (2026-10-30T09:00:00+09:00), a local time (2026-10-30T09:00) or a date (2026-10-30)",
};
const SPAN = {
  type: "object",
  properties: {
    from: { ...TIME, description: `${TIME.description}; today when absent` },
    to: { ...TIME, description: `${TIME.description}; seven days after from when absent` },
  },
  additionalProperties: false,
};

/**
 * A time argument as a wall time in `zone` and whether it was a bare date.
 * @param {unknown} value
 * @param {Zone} zone
 */
function timeArg(value, zone) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (date)
    return { wall: Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])), date: true };
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (local) {
    const [y, m, d, h, mi, s] = local.slice(1).map((n) => Number(n ?? 0));
    return { wall: Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0), date: false };
  }
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(text)) return undefined;
  const instant = Date.parse(text);
  return Number.isNaN(instant) ? undefined : { wall: instant + zone.offset(instant), date: false };
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {object} host
 * @param {() => Cal[]} host.calendars
 * @param {() => Cal | undefined} host.shown
 * @param {() => Zone} host.display
 * @param {() => number} host.now
 * @param {() => string} host.uid
 * @param {() => Promise<Cal>} host.readDefault
 * @param {() => Promise<unknown>} host.openDefault
 * @param {(cal: Cal, doc: Document, message: string) => void} host.change
 * @param {(cal: Cal) => Cal} host.writable
 */
export function createAgentCommands(ctx, host) {
  /**
   * @param {string} id
   * @param {string} title
   * @param {string} description
   * @param {object} argsSchema
   * @param {(args: Record<string, unknown>) => unknown} run
   */
  const provide = (id, title, description, argsSchema, run) => {
    void ctx.bridge
      .call("cmd.register", {
        id,
        title,
        description,
        keywords: ["calendar", "agenda"],
        argsSchema,
      })
      .catch(() => {});
    ctx.commands.on(id, (args) => run(/** @type {Record<string, unknown>} */ (args ?? {})));
  };

  /** The span a call asks about, as instants. */
  const spanOf = (/** @type {Record<string, unknown>} */ args) => {
    const zone = host.display();
    const today = Math.floor((host.now() + zone.offset(host.now())) / DAY) * DAY;
    const from = args.from === undefined ? { wall: today } : timeArg(args.from, zone);
    if (!from) throw new Error(`from: ${String(args.from)} is not a time.`);
    const to = args.to === undefined ? { wall: from.wall + 7 * DAY } : timeArg(args.to, zone);
    if (!to) throw new Error(`to: ${String(args.to)} is not a time.`);
    if (to.wall <= from.wall) throw new Error("to must come after from.");
    if (to.wall - from.wall > MAX_DAYS * DAY)
      throw new Error(`A span is ${MAX_DAYS} days at most.`);
    return { from: zone.toUtc(from.wall), to: zone.toUtc(to.wall) };
  };

  /** The calendars a read covers: the open ones, or the default file. */
  const readable = async () => {
    const open = host.calendars();
    if (open.length) return open;
    return [await host.readDefault()];
  };

  const itemsIn = async (/** @type {Record<string, unknown>} */ args) => {
    const { from, to } = spanOf(args);
    return (await readable()).flatMap((cal) =>
      occurrences(cal.model, from, to).map((occ) => ({
        occ,
        item: toItem(occ, cal.model, { connector: PLUGIN, instance: instanceName(cal.name) }),
      })),
    );
  };

  provide(
    "endue.calendar.events",
    "Calendar: list events",
    "The events between from and to in the open calendars, as specs/item/v0 event items, earliest first.",
    {
      ...SPAN,
      properties: {
        ...SPAN.properties,
        text: {
          type: "string",
          description: "Only events whose title, place or notes hold this text",
        },
      },
    },
    async (args) => {
      const words = typeof args.text === "string" ? args.text.trim().toLowerCase() : "";
      const found = (await itemsIn(args)).filter(
        ({ occ }) =>
          !words ||
          [occ.title, occ.location, occ.description].some((t) => t?.toLowerCase().includes(words)),
      );
      return { timeZone: host.display().id, items: found.map((f) => f.item) };
    },
  );

  provide(
    "endue.calendar.conflicts",
    "Calendar: find overlapping events",
    "Pairs of busy events between from and to that overlap, with when the overlap starts and ends.",
    SPAN,
    async (args) => {
      const found = await itemsIn(args);
      const byOcc = new Map(found.map((f) => [f.occ, f.item]));
      const zone = host.display();
      const at = (/** @type {number} */ utc) =>
        new Date(utc + zone.offset(utc)).toISOString().slice(0, 16);
      return {
        timeZone: zone.id,
        conflicts: conflicts(found.map((f) => f.occ)).map((c) => ({
          a: byOcc.get(c.a),
          b: byOcc.get(c.b),
          from: at(c.from),
          to: at(c.to),
          minutes: Math.round((c.to - c.from) / MINUTE),
        })),
      };
    },
  );

  provide(
    "endue.calendar.add",
    "Calendar: add an event",
    "Adds an event to the calendar on screen (or the default calendar file) and answers it as an item. The change is unsaved until the person saves.",
    {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        start: TIME,
        end: {
          ...TIME,
          description: `${TIME.description}; the default length after start when absent`,
        },
        allDay: { type: "boolean" },
        timeZone: {
          type: "string",
          description: "An IANA zone for local times; the person's zone when absent",
        },
        location: { type: "string" },
        description: { type: "string" },
        rrule: { type: "string", description: "An RFC 5545 RRULE value, FREQ=WEEKLY;BYDAY=MO" },
        reminder: { type: "integer", description: "Minutes before the start" },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
    async (args) => {
      const zoneName =
        typeof args.timeZone === "string" && args.timeZone ? args.timeZone : host.display().id;
      const zone = ianaZone(zoneName);
      if (!zone) throw new Error(`timeZone: ${zoneName} is not a time zone.`);
      const start = timeArg(args.start, zone);
      if (!start) throw new Error(`start: ${String(args.start)} is not a time.`);
      const allDay = typeof args.allDay === "boolean" ? args.allDay : start.date;
      const end = args.end === undefined ? undefined : timeArg(args.end, zone);
      if (args.end !== undefined && !end)
        throw new Error(`end: ${String(args.end)} is not a time.`);
      const from = allDay ? Math.floor(start.wall / DAY) * DAY : start.wall;
      const until = end
        ? allDay
          ? Math.ceil(end.wall / DAY) * DAY
          : end.wall
        : from + (allDay ? DAY : 60 * MINUTE);
      if (until <= from) throw new Error("end must come after start.");
      const rrule = typeof args.rrule === "string" ? args.rrule.trim() : undefined;
      const parsed = rrule ? parseRule(rrule) : undefined;
      if (parsed && "error" in parsed) throw new Error(`rrule: ${parsed.error}.`);
      if (!host.shown()) await host.openDefault();
      const cal = host.shown();
      if (!cal) throw new Error("No calendar is open.");
      host.writable(cal);
      const title = String(args.title).trim();
      const { doc, uid } = createEvent(
        cal.doc,
        {
          title,
          allDay,
          start: from,
          end: until,
          zone: allDay ? "" : zone.id,
          ...(typeof args.location === "string" ? { location: args.location } : {}),
          ...(typeof args.description === "string" ? { description: args.description } : {}),
          rrule: rrule ?? null,
          reminder: Number.isInteger(args.reminder) ? /** @type {number} */ (args.reminder) : null,
        },
        { now: host.now(), uid: host.uid, display: host.display() },
      );
      host.change(cal, doc, `Added ${title}.`);
      const first = occurrences(cal.model, zone.toUtc(from) - DAY, zone.toUtc(until) + DAY).find(
        (o) => o.uid === uid,
      );
      return {
        item:
          first &&
          toItem(first, cal.model, { connector: PLUGIN, instance: instanceName(cal.name) }),
      };
    },
  );
}
