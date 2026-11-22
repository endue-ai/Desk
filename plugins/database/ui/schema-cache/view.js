// What a connection's cache answers without waiting: the schemas the explorer lists, which of them
// are read (chosen), held and kept on disk, and each held schema's objects, columns, parts, foreign
// keys and routines; `objects(DATABASE)` the database's and the server's (PG-50). Undefined means
// "not held here": the caller reads it from the catalog. Pure.

import { clock, day, t } from "../strings/index.js";
import { DATABASE } from "./kinds.js";
import { lookupOf } from "./model.js";

/**
 * @typedef {import("./model.js").SchemaData} SchemaData
 * @typedef {"idle" | "reading" | "error" | "cancelled"} State
 * @typedef {{ state: State, step?: number, steps?: number, label?: string, message?: string }} Status
 * @typedef {{
 *   schemas: Map<string, SchemaData>, all: [string, string][], chosen: string[] | null,
 *   over: Set<string>, readAt: number | null, status: Status, note: string,
 * }} Held
 * @typedef {{ name: string, system: boolean, chosen: boolean, held: boolean, kept: boolean }} SchemaState
 */

/**
 * Whether a schema is read: the person's list, else every one but the system ones. The database
 * level (DATABASE) is always read.
 */
export const isChosen = (
  /** @type {string[] | null} */ chosen,
  /** @type {string} */ name,
  /** @type {boolean} */ system,
) => name === DATABASE || (chosen ? chosen.includes(name) : !system);

/**
 * @param {Held} held
 * @param {boolean} systemSchemas Whether the explorer lists system schemas (the setting).
 */
export function viewOf(held, systemSchemas) {
  const lookup = (/** @type {string} */ schema) => {
    const data = held.schemas.get(schema);
    return data ? lookupOf(data) : undefined;
  };
  /** @type {() => SchemaState[]} */
  const all = () => {
    const known = held.all.length
      ? held.all
      : [...held.schemas.keys()].map((name) => /** @type {[string, string]} */ ([name, ""]));
    return known.flatMap(([name, s]) => {
      if (name === DATABASE) return [];
      const system = s === "s";
      const has = held.schemas.has(name);
      return [
        {
          name,
          system,
          chosen: isChosen(held.chosen, name, system),
          held: has,
          kept: has && !held.over.has(name),
        },
      ];
    });
  };
  /** @template T @param {(l: import("./model.js").Lookup) => Map<string, T[]>} pick */
  const ofTable = (pick) => (/** @type {string} */ schema, /** @type {string} */ table) => {
    const found = lookup(schema);
    if (!found?.relations.has(table)) return undefined;
    return pick(found).get(table) ?? [];
  };
  return {
    /** When the cache was last read or checked against the server (ms), or null. */
    readAt: held.readAt,
    status: held.status,
    /** Why the cache could not be written to the store, or "". */
    note: held.note,
    /** Every schema the server has, read or not. */
    all,
    /** The schemas the explorer lists: system ones only with the setting or when chosen. */
    listed: () => all().flatMap((s) => (!s.system || systemSchemas || s.chosen ? [s.name] : [])),
    /** The schemas held in memory. */
    schemas: () => [...held.schemas.keys()].filter((name) => name !== DATABASE),
    chosen: (/** @type {string} */ schema) =>
      isChosen(held.chosen, schema, all().find((s) => s.name === schema)?.system ?? false),
    held: (/** @type {string} */ schema) => held.schemas.has(schema),
    kept: (/** @type {string} */ schema) => held.schemas.has(schema) && !held.over.has(schema),
    objects: (/** @type {string} */ schema) => lookup(schema)?.objects,
    columns: ofTable((l) => l.columns),
    parts: ofTable((l) => l.parts),
    foreignKeys: ofTable((l) => l.foreignKeys),
    routines: (/** @type {string} */ schema) => lookup(schema)?.routines,
    comment: (/** @type {string} */ schema, /** @type {string} */ table) =>
      lookup(schema)?.comments.get(table) ?? "",
  };
}

/** @typedef {ReturnType<typeof viewOf>} CacheView */

/**
 * "read 14:05" today, "read 2026-11-20 14:05" before, on the 24-hour clock; with `seconds`,
 * "read 14:05:09" (the activity view, which reads every few seconds).
 */
export function readAtText(/** @type {number} */ readAt, now = Date.now(), seconds = false) {
  const at = new Date(readAt);
  const today = new Date(now);
  const time = clock(at, seconds);
  const same =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return same ? t("cache.readToday", { time }) : t("cache.readBefore", { date: day(at), time });
}

/**
 * What the explorer says of a connection's cache: its row's detail (when it was read, or how far a
 * pass has come), the progress line while nothing is held yet, a line when a check failed, and a
 * schema's detail ("not cached": not chosen; "not kept": past the store's cap).
 * @param {CacheView | undefined} view
 */
export function labelsOf(view, now = Date.now()) {
  if (!view) return undefined;
  const { status } = view;
  const reading =
    status.state === "reading"
      ? t("cache.step", { label: status.label, step: status.step, steps: status.steps })
      : "";
  const failed = status.state === "error" || status.state === "cancelled";
  return {
    detail: reading
      ? t("cache.reading", { what: reading })
      : view.readAt
        ? readAtText(view.readAt, now)
        : "",
    progress: reading ? t("cache.progress", { what: reading }) : undefined,
    stale:
      failed && view.readAt ? t("cache.stale", { why: status.message ?? t("cache.failed") }) : "",
    schema: (/** @type {string} */ name) =>
      !view.chosen(name)
        ? t("cache.notCached")
        : view.held(name) && !view.kept(name)
          ? t("cache.notKept")
          : "",
  };
}
