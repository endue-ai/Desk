// The system calendar as a read-only layer beside the file's events: the event items the desk.calendar
// connector brings into the desk's index (specs/item/v0), read with data.query under the plugin's
// data:read grant and followed with data.subscribe. Each of the system's calendars is a source with
// its own name and colour, which the person can hide; nothing here changes an event. Without the grant
// (or without the connector) the layer is empty and the plugin works on files alone.
import { DAY } from "./ical/values.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").DataReadPermission} DataReadPermission
 * @typedef {import("@endue-ai/bridge").EventItem} EventItem
 * @typedef {import("@endue-ai/bridge").ItemChange} ItemChange
 * @typedef {import("./ical/zones.js").Zone} Zone
 *
 * @typedef {object} Source one calendar of the system's
 * @property {string} key `connector/instance/calendar id`
 * @property {string} name
 * @property {string} [color] `#rrggbb`, the calendar's own
 * @property {boolean} hidden
 *
 * @typedef {object} LayerOccurrence an event of the layer: drawn as an occurrence, never edited
 * @property {string} id @property {string} source the key of its Source
 * @property {string} sourceName @property {string} [color]
 * @property {number} start @property {number} end instants
 * @property {number} startWall @property {number} endWall in the display zone
 * @property {boolean} allDay @property {string} title @property {string} [location]
 * @property {string} status @property {boolean} free @property {boolean} recurring
 * @property {true} readOnly
 */

const CONNECTOR = "desk.calendar";
/** The scope of every read: the system calendar's events, nothing else of the index. */
export const LAYER_READ = /** @type {DataReadPermission} */ ({
  permission: "data:read",
  kinds: ["event"],
  sources: [CONNECTOR],
});
const QUERY = /** @type {const} */ ({ kinds: ["event"], sources: [CONNECTOR] });
const PAGE = 500;
const MOST = 5000;
const COLOR = /^#[0-9a-f]{6}$/i;
const PREFIX = "system:";

const itemKey = (
  /** @type {{ connector: string, instance: string }} */ s,
  /** @type {string} */ id,
) => `${s.connector}/${s.instance}#${id}`;

/** The calendar an item belongs to: by the id the connector gives it, else by its name. */
export function sourceOf(/** @type {EventItem} */ item) {
  const raw = /** @type {Record<string, unknown>} */ (item.raw ?? {});
  const id = typeof raw.calendarId === "string" ? raw.calendarId : (item.calendar ?? "");
  const color = typeof raw.color === "string" && COLOR.test(raw.color) ? raw.color : undefined;
  return {
    key: `${item.source.connector}/${item.source.instance}/${id}`,
    name: item.calendar || "System calendar",
    ...(color ? { color } : {}),
  };
}

/** A wall time from the date an RFC 3339 time is written on (an all-day event's local midnight). */
const dateWall = (/** @type {string} */ text) =>
  Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));

/**
 * An event item as an occurrence in the display zone. All-day events keep their dates and begin at
 * midnight there, as a file's do; timed ones keep their instants.
 * @param {EventItem} item
 * @param {Zone} display
 * @returns {LayerOccurrence}
 */
export function layerOccurrence(item, display) {
  const { key, name, color } = sourceOf(item);
  let start = Date.parse(item.start);
  let end = Math.max(start, Date.parse(item.end));
  let startWall = start + display.offset(start);
  let endWall = end + display.offset(end);
  if (item.allDay) {
    startWall = dateWall(item.start);
    endWall = Math.max(dateWall(item.end), startWall + DAY);
    start = display.toUtc(startWall);
    end = display.toUtc(endWall);
  }
  return {
    id: PREFIX + itemKey(item.source, item.id),
    source: key,
    sourceName: name,
    ...(color ? { color } : {}),
    start,
    end,
    startWall,
    endWall,
    allDay: Boolean(item.allDay),
    title: item.title.trim() || "(No title)",
    ...(item.location ? { location: item.location } : {}),
    status: "CONFIRMED",
    free: Boolean(item.allDay),
    recurring: Boolean(item.recurrence),
    readOnly: true,
  };
}

/**
 * @param {Pick<PluginContext, "data">} ctx
 * @param {object} host
 * @param {() => void} host.changed the layer's events or calendars changed: draw again
 * @param {(hidden: string[]) => void} host.remember keep the hidden calendars
 * @param {unknown} [host.hidden] the hidden calendars kept before
 */
export function createLayer({ data }, host) {
  /** @type {Map<string, EventItem>} */
  const items = new Map();
  const hidden = new Set(
    Array.isArray(host.hidden) ? host.hidden.filter((k) => typeof k === "string") : [],
  );
  const put = (/** @type {EventItem} */ item) => items.set(itemKey(item.source, item.id), item);

  const apply = (/** @type {ItemChange[]} */ changes) => {
    for (const c of changes) {
      if (c.change === "removed") items.delete(itemKey(c.source, c.id));
      else if (c.item.kind === "event" && c.item.source.connector === CONNECTOR) put(c.item);
    }
    host.changed();
  };

  /** Every event the index holds for the connector, then its changes; a refusal leaves none. */
  const ready = (async () => {
    try {
      /** @type {string | undefined} */
      let cursor;
      do {
        const query = { ...QUERY, limit: PAGE, ...(cursor ? { cursor } : {}) };
        const page = await data.query(query, { scope: LAYER_READ });
        for (const item of page.items) if (item.kind === "event") put(item);
        cursor = page.cursor;
      } while (cursor && items.size < MOST);
    } catch {
      return;
    }
    if (items.size) host.changed();
    await data.subscribe(QUERY, apply, { scope: LAYER_READ }).catch(() => undefined);
  })();

  /** @returns {Source[]} by name */
  const sources = () => {
    /** @type {Map<string, Source>} */
    const out = new Map();
    for (const item of items.values()) {
      const source = sourceOf(item);
      if (!out.has(source.key)) out.set(source.key, { ...source, hidden: hidden.has(source.key) });
    }
    return [...out.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    );
  };

  /**
   * The shown calendars' events that overlap the days of a view.
   * @param {{ from: number, to: number }} days day numbers, [from, to)
   * @param {Zone} display
   */
  const occurrences = (days, display) => {
    const from = display.toUtc(days.from * DAY);
    const to = display.toUtc(days.to * DAY);
    return [...items.values()]
      .filter((item) => !hidden.has(sourceOf(item).key))
      .map((item) => layerOccurrence(item, display))
      .filter(
        (o) =>
          Number.isFinite(o.start) &&
          Number.isFinite(o.end) &&
          o.start < to &&
          (o.end > from || (o.end === o.start && o.start >= from)),
      );
  };

  /**
   * Hide or show one calendar (by key or name) or, without one, all of them: `on` shows, absent
   * flips (all: hide every one while any shows).
   * @param {string} [calendar]
   * @param {boolean} [on]
   */
  const toggle = (calendar, on) => {
    const all = sources();
    const chosen = calendar ? all.filter((s) => s.key === calendar || s.name === calendar) : all;
    if (calendar && chosen.length === 0)
      throw new Error(`The system calendar has no calendar ${calendar}.`);
    const show = on ?? (calendar ? chosen.every((s) => s.hidden) : all.every((s) => s.hidden));
    for (const s of chosen) {
      if (show) hidden.delete(s.key);
      else hidden.add(s.key);
    }
    host.remember([...hidden]);
    host.changed();
    return sources();
  };

  return {
    /** Resolves once the first read is done, whatever it found. */
    ready: () => ready,
    sources,
    occurrences,
    toggle,
    /** endue.calendar.layer `{ calendar?, on? }`: a calendar by name or key, or all of them. */
    command: (/** @type {unknown} */ args) => {
      const { calendar, on } = /** @type {{ calendar?: unknown, on?: unknown }} */ (args ?? {});
      const named = typeof calendar === "string" && calendar !== "" ? calendar : undefined;
      return toggle(named, typeof on === "boolean" ? on : undefined);
    },
    /** Why an event cannot be edited, when it is the layer's; undefined for a file's. */
    readOnly: (/** @type {string} */ id, /** @type {Zone} */ display) => {
      const item = id.startsWith(PREFIX) ? items.get(id.slice(PREFIX.length)) : undefined;
      const occ = item && layerOccurrence(item, display);
      return occ && `"${occ.title}" is from ${occ.sourceName}; it is read-only here.`;
    },
  };
}
