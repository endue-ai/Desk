// Commands for agents, Eris and other plugins: the events of a time span as specs/item/v0 items, the
// busy events that overlap, and adding an event. They are registered with cmd.register and an argument
// schema, so callers see what to send, and as agents' tools, the two reads marked so (ADR 0088);
// every action goes through the command registry (ADR 0032).
// Reads cover the open calendars, or the calendar file the settings name when none is open.
import { SPECS } from "./agent-specs.js";
import { createEvent, deleteEvent, fieldsOf, updateEvent } from "./calendar/edit.js";
import { conflicts, instanceName, toItem } from "./calendar/items.js";
import { MODES, span } from "./calendar/layout.js";
import { occurrences } from "./calendar/model.js";
import { dayFrom } from "./date.js";
import { parseRule } from "./ical/rrule.js";
import { DAY, MINUTE, rfc3339 } from "./ical/values.js";
import { ianaZone } from "./ical/zones.js";
import { isLayerId } from "./layer.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/plugin-sdk").Invocation} Invocation
 * @typedef {import("./calendar.js").Cal} Cal
 * @typedef {import("./calendar.js").At} At
 * @typedef {import("./calendar/model.js").Occurrence} Occurrence
 * @typedef {import("./calendar/layout.js").Mode} Mode
 * @typedef {import("./ical/zones.js").Zone} Zone
 * @typedef {import("./ical/component.js").Document} Document
 */

const PLUGIN = "endue.calendar";
/** The longest span one call reads. */
const MAX_DAYS = 366;

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
  return Number.isNaN(instant)
    ? undefined
    : { wall: instant + zone.offset(instant), date: false, instant };
}

const dateOf = (/** @type {number} */ day) => new Date(day * DAY).toISOString().slice(0, 10);

const itemOf = (/** @type {Cal} */ cal, /** @type {Occurrence} */ occ) => {
  const item = toItem(occ, cal.model, { connector: PLUGIN, instance: instanceName(cal.name) });
  return { ...item, raw: { ...item.raw, path: cal.path } };
};

/** A new event's fields for the editor or the calendar buffer. */
function prepare(/** @type {Record<string, unknown>} */ args, /** @type {Zone} */ display) {
  const zoneName = typeof args.timeZone === "string" && args.timeZone ? args.timeZone : display.id;
  const zone = ianaZone(zoneName);
  if (!zone) throw new Error(`timeZone: ${zoneName} is not a time zone.`);
  const startArg = timeArg(args.start, zone);
  if (args.start !== undefined && !startArg)
    throw new Error(`start: ${String(args.start)} is not a time.`);
  const allDay = typeof args.allDay === "boolean" ? args.allDay : (startArg?.date ?? false);
  const endArg = timeArg(args.end, zone);
  if (args.end !== undefined && !endArg) throw new Error(`end: ${String(args.end)} is not a time.`);
  if (endArg && !startArg) throw new Error("Give a start before giving an end.");
  const start = startArg
    ? allDay
      ? Math.floor(startArg.wall / DAY) * DAY
      : startArg.wall
    : undefined;
  const end =
    start === undefined
      ? undefined
      : endArg
        ? allDay
          ? Math.ceil(endArg.wall / DAY) * DAY
          : endArg.wall
        : start + (allDay ? DAY : 60 * MINUTE);
  if (start !== undefined && end !== undefined && end <= start)
    throw new Error("end must come after start.");
  const rrule = typeof args.rrule === "string" ? args.rrule.trim() : undefined;
  const parsed = rrule ? parseRule(rrule) : undefined;
  if (parsed && "error" in parsed) throw new Error(`rrule: ${parsed.error}.`);
  return {
    zone,
    start,
    end,
    fields: {
      ...(typeof args.title === "string" ? { title: args.title.trim() } : {}),
      ...(typeof args.location === "string" ? { location: args.location } : {}),
      ...(typeof args.description === "string" ? { description: args.description } : {}),
      ...(rrule !== undefined ? { rrule: rrule || null } : {}),
      ...(Number.isInteger(args.reminder)
        ? { reminder: /** @type {number} */ (args.reminder) }
        : {}),
      allDay,
      zone: allDay ? "" : zone.id,
    },
  };
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
 * @param {ReturnType<typeof import("./layer.js").createLayer>} host.layer
 * @param {() => {mode: Mode, anchor: number, weekStart: number,
 *   event?: { cal: Cal, occ: Occurrence } | undefined}} host.screen
 * @param {(view?: Mode, day?: number) => void} host.navigate
 * @param {(at?: At) => unknown} host.compose
 * @param {(cal: Cal, doc: Document, message: string) => void} host.change
 * @param {(cal: Cal) => Cal} host.writable
 * @param {(cal: Cal, byAgent: boolean) => Promise<unknown>} host.save
 */
export function createAgentCommands(ctx, host) {
  const provide = (
    /** @type {string} */ id,
    /** @type {(args: Record<string, unknown>, invocation?: Invocation) => unknown} */ run,
  ) => {
    if (!(id in SPECS)) throw new Error(`${id} has no spec`);
    ctx.commands.on(id, (args, invocation) =>
      run(/** @type {Record<string, unknown>} */ (args ?? {}), invocation),
    );
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
    try {
      return [await host.readDefault()];
    } catch (error) {
      if (error instanceof Error && /: not_found\.$/.test(error.message)) return [];
      throw error;
    }
  };

  const itemsIn = async (/** @type {Record<string, unknown>} */ args) => {
    const { from, to } = spanOf(args);
    await host.layer.ready();
    const zone = host.display();
    const fileEntries = (await readable()).flatMap((cal) =>
      occurrences(cal.model, from, to).map((occ) => ({
        occ,
        item: itemOf(cal, occ),
      })),
    );
    const at = (/** @type {number} */ utc) => rfc3339(utc, zone.offset(utc));
    const layerEntries = host.layer.entries(from, to, zone).map(({ occ, item }) => ({
      occ,
      item: {
        ...item,
        id: occ.id.slice(0, 512),
        title: occ.title.slice(0, 1000),
        start: at(occ.start),
        end: at(occ.end),
        raw: { ...item.raw, readOnly: true },
      },
    }));
    return [...fileEntries, ...layerEntries].sort((a, b) => a.occ.start - b.occ.start);
  };

  provide("endue.calendar.events", async (args) => {
    const words = typeof args.text === "string" ? args.text.trim().toLowerCase() : "";
    const found = (await itemsIn(args)).filter(
      ({ item }) =>
        !words ||
        [item.title, item.location, item.body].some((t) => t?.toLowerCase().includes(words)),
    );
    return { timeZone: host.display().id, items: found.map((f) => f.item) };
  });

  provide("endue.calendar.conflicts", async (args) => {
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
  });

  const calendarOf = (/** @type {unknown} */ target) => {
    if (target === undefined) return undefined;
    const cal = host.calendars().find((cal) => cal.buffer === target || cal.path === target);
    if (!cal) throw new Error("Name an open calendar by file path or buffer ID.");
    return cal;
  };

  const current = () => {
    const screen = host.screen();
    const range = span(screen.mode, screen.anchor, screen.weekStart);
    const cal = host.shown();
    return {
      view: screen.mode,
      date: dateOf(screen.anchor),
      span: { from: dateOf(range.from), to: dateOf(range.to) },
      calendar: cal
        ? { name: cal.name, path: cal.path, buffer: cal.buffer, modified: cal.modified }
        : null,
      event: screen.event ? itemOf(screen.event.cal, screen.event.occ) : null,
    };
  };

  provide("endue.calendar.current", current);
  provide("endue.calendar.show", (args) => {
    const { date, view } = args;
    const mode = /** @type {Mode | undefined} */ (view);
    if (mode !== undefined && !MODES.includes(mode))
      throw new Error("Use month, week, day or agenda.");
    const now = host.now();
    const today = Math.floor((now + host.display().offset(now)) / DAY);
    const day = typeof date === "string" ? dayFrom(date, today) : undefined;
    if (date !== undefined && day === undefined)
      throw new Error("Give a date, such as YYYY-MM-DD.");
    host.navigate(mode, day);
    return current();
  });

  provide("endue.calendar.new", (args) => {
    const input = args.fields;
    if (input === undefined) return host.compose();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Give the fields of the new event.");
    const { fields, start, end } = prepare(
      /** @type {Record<string, unknown>} */ (input),
      host.display(),
    );
    return host.compose({
      fields: { ...fields, ...(start === undefined ? {} : { start, end }) },
    });
  });

  provide("endue.calendar.add", async (args) => {
    const { fields, start, end, zone } = prepare(args, host.display());
    if (start === undefined || end === undefined) throw new Error("Give the event's start.");
    const { title } = fields;
    if (!title) throw new Error("Give the event's title.");
    const named = calendarOf(args.calendar);
    if (!named && !host.shown()) await host.openDefault();
    const cal = named ?? host.shown();
    if (!cal) throw new Error("No calendar is open.");
    host.writable(cal);
    const { doc, uid } = createEvent(
      cal.doc,
      {
        rrule: null,
        reminder: null,
        ...fields,
        title,
        start,
        end,
      },
      { now: host.now(), uid: host.uid, display: host.display() },
    );
    host.change(cal, doc, `Added ${title}.`);
    const first = occurrences(cal.model, zone.toUtc(start) - DAY, zone.toUtc(end) + DAY).find(
      (o) => o.uid === uid,
    );
    return {
      item: first && itemOf(cal, first),
    };
  });

  /** The event named by its id and start in any open writable calendar. */
  const namedEvent = (/** @type {Record<string, unknown>} */ args) => {
    if (isLayerId(args.id)) throw new Error("The system calendar event is read-only here.");
    const cal = calendarOf(args.calendar);
    const open = cal ? [cal] : host.calendars();
    if (open.length === 0)
      throw new Error("No calendar is open: open one, or add to the default one first.");
    const zone = host.display();
    const at = timeArg(args.start, zone);
    if (!at) throw new Error(`start: ${String(args.start)} is not a time.`);
    const near = at.instant ?? zone.toUtc(at.wall);
    const matches = open.flatMap((cal) =>
      occurrences(cal.model, near - DAY, near + DAY)
        .filter((occ) => occ.id === args.id && (at.date ? occ.start >= near : occ.start === near))
        .map((occ) => ({ cal, occ })),
    );
    if (matches.length > 1)
      throw new Error("More than one calendar has this event. Give the file path.");
    const match = matches[0];
    if (!match) throw new Error(`There is no event ${String(args.id)} near that start.`);
    host.writable(match.cal);
    const scope = args.scope === "following" || args.scope === "all" ? args.scope : "one";
    return { ...match, scope: /** @type {"one" | "following" | "all"} */ (scope) };
  };

  provide("endue.calendar.update", async (args) => {
    const { cal, occ, scope } = namedEvent(args);
    const display = host.display();
    const fields = fieldsOf(occ, display);
    const zoneName =
      typeof args.timeZone === "string" && args.timeZone
        ? args.timeZone
        : fields.zone || display.id;
    const zone = ianaZone(zoneName);
    if (!zone) throw new Error(`timeZone: ${zoneName} is not a time zone.`);
    const length = fields.end - fields.start;
    const moved = args.newStart === undefined ? undefined : timeArg(args.newStart, zone);
    if (args.newStart !== undefined && !moved)
      throw new Error(`newStart: ${String(args.newStart)} is not a time.`);
    const allDay = typeof args.allDay === "boolean" ? args.allDay : (moved?.date ?? fields.allDay);
    const start = moved ? (allDay ? Math.floor(moved.wall / DAY) * DAY : moved.wall) : fields.start;
    const end = args.end === undefined ? undefined : timeArg(args.end, zone);
    if (args.end !== undefined && !end) throw new Error(`end: ${String(args.end)} is not a time.`);
    const until = end ? (allDay ? Math.ceil(end.wall / DAY) * DAY : end.wall) : start + length;
    if (until <= start) throw new Error("end must come after start.");
    const rrule = typeof args.rrule === "string" ? args.rrule.trim() : undefined;
    const parsed = rrule ? parseRule(rrule) : undefined;
    if (parsed && "error" in parsed) throw new Error(`rrule: ${parsed.error}.`);
    const text = (/** @type {unknown} */ v) => (typeof v === "string" ? { value: v } : undefined);
    const next = {
      ...fields,
      ...(typeof args.title === "string" && args.title.trim() ? { title: args.title.trim() } : {}),
      allDay,
      start,
      end: until,
      zone: allDay ? "" : args.timeZone || moved ? zone.id : fields.zone,
      ...(text(args.location) ? { location: args.location } : {}),
      ...(text(args.description) ? { description: args.description } : {}),
      ...(rrule !== undefined ? { rrule: rrule || null } : {}),
      ...(Number.isInteger(args.reminder)
        ? { reminder: /** @type {number} */ (args.reminder) }
        : {}),
    };
    const context = { now: host.now(), uid: host.uid, display };
    const doc = updateEvent(cal.doc, occ, /** @type {never} */ (next), scope, context);
    host.change(cal, doc, `Changed ${next.title}.`);
    const near = zone.toUtc(start);
    const found = occurrences(cal.model, near - 2 * DAY, near + 2 * DAY).find(
      (o) => o.uid === occ.uid,
    );
    return { item: found && itemOf(cal, found) };
  });

  provide("endue.calendar.delete", async (args) => {
    const { cal, occ, scope } = namedEvent(args);
    const context = { now: host.now(), uid: host.uid, display: host.display() };
    host.change(cal, deleteEvent(cal.doc, occ, scope, context), `Deleted ${occ.title}.`);
    return { deleted: occ.id };
  });

  provide("endue.calendar.save", async (args, invocation) => {
    const byAgent = invocation?.caller.startsWith("agent:") === true;
    if (byAgent && args.calendar === undefined)
      throw new Error("Give the calendar file path or buffer ID.");
    const cal = calendarOf(args.calendar) ?? host.shown();
    if (!cal?.modified) return { path: null };
    await host.save(cal, byAgent);
    return { path: cal.path };
  });
}
