// Chart, stat and detail (ADR 0103): the presentations item views had as components, over rows.
// A chart draws the value role over time (rows with a start) or per group, and counts per group when
// no row has a value; a stat is one number; a detail is one entry's fields. Pure.
import type { ChartKind, UniversalAggregate } from "@endue-ai/bridge";
import { UNIVERSAL_ROLES, type UniversalRow } from "./rows";
import { dayLabel, dayOf, timeText, type UniversalEnv } from "./time";

export interface ChartPoint {
  /** The row's key, or the group's name for counts. */
  key: string;
  label: string;
  value: number;
}

export interface ChartModel {
  kind: ChartKind;
  points: ChartPoint[];
  /** The largest value, 0 for none: the bars' and the line's top. */
  max: number;
  /** The smallest value, 0 or below. */
  min: number;
}

/** The value role over time or per row, or counts per group when no row has a value. */
export function chartOf(
  rows: UniversalRow[],
  env: UniversalEnv,
  kind: ChartKind = "bar",
): ChartModel {
  const valued = rows.filter((row) => row.value !== undefined);
  let points: ChartPoint[];
  if (valued.length > 0) {
    const timed = valued.every((row) => row.start !== undefined);
    const ordered = timed ? [...valued].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)) : valued;
    points = ordered.map((row) => ({
      key: row.key,
      label: timed && row.start !== undefined ? whenText(row.start, env) : row.title || row.group,
      value: row.value ?? 0,
    }));
  } else {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
    points = [...counts].map(([group, value]) => ({
      key: group,
      label: group || "No group",
      value,
    }));
  }
  const values = points.map((p) => p.value);
  return {
    kind,
    points,
    max: Math.max(0, ...values),
    min: Math.min(0, ...values),
  };
}

const whenText = (at: number, env: UniversalEnv) =>
  `${dayLabel(dayOf(at, env.zone), env, new Date(env.now).getUTCFullYear())} ${timeText(at, env)}`.trim();

export interface StatModel {
  /** The number, or null when there is nothing to count from. */
  value: number | null;
  /** How it was made: "count", "sum" or "latest". */
  aggregate: UniversalAggregate;
}

/** One number: the rows counted, their values summed, or the latest value by start. */
export function statOf(rows: UniversalRow[], aggregate: UniversalAggregate = "count"): StatModel {
  if (aggregate === "count") return { value: rows.length, aggregate };
  const valued = rows.filter((row) => row.value !== undefined);
  if (valued.length === 0) return { value: null, aggregate };
  if (aggregate === "sum")
    return { value: valued.reduce((sum, row) => sum + (row.value ?? 0), 0), aggregate };
  const latest = valued.reduce((a, b) =>
    (b.start ?? -Infinity) >= (a.start ?? -Infinity) ? b : a,
  );
  return { value: latest.value ?? null, aggregate };
}

export interface DetailField {
  label: string;
  value: string;
}

export interface DetailModel {
  row: UniversalRow | null;
  /** The roles the row has, then the entry's other fields that read as one line. */
  fields: DetailField[];
}

const SHOWN_ROLES = UNIVERSAL_ROLES.filter((role) => !["id", "title", "text"].includes(role));

/** How the detail names a role; another field's name is spelled out (updatedAt: Updated at). */
const ROLE_LABELS: Record<string, string> = {
  start: "When",
  end: "Ends",
  author: "From",
  url: "Link",
};
const labelOf = (name: string) =>
  ROLE_LABELS[name] ??
  name
    .replace(/([a-z0-9])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`)
    .replace(/^./, (c) => c.toUpperCase());
/** A field that is an RFC 3339 instant, drawn as a day and time like the roles. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** One row's fields: the selected one (by key), else the first. */
export function detailOf(
  rows: UniversalRow[],
  env: UniversalEnv,
  key?: string | null,
): DetailModel {
  const row = rows.find((r) => r.key === key) ?? rows[0] ?? null;
  if (!row) return { row: null, fields: [] };
  const fields: DetailField[] = [];
  const add = (name: string, value: string) => {
    if (value) fields.push({ label: labelOf(name), value });
  };
  for (const role of SHOWN_ROLES) {
    if (role === "start" || role === "end") {
      const at = row[role];
      if (at !== undefined) add(role, whenText(at, env));
    } else if (role === "tags") add(role, row.tags.join(", "));
    else if (role === "value") add(role, row.value === undefined ? "" : String(row.value));
    // A group that is only the status says it twice.
    else if (role === "group" && row.group === row.status) continue;
    else add(role, String(row[role] ?? ""));
  }
  // An item's source (ADR 0103: desk.item) is where it is from.
  const source = row.entry.source as { connector?: unknown } | undefined;
  if (typeof source?.connector === "string" && !row.author) add("author", source.connector);
  const used = new Set<string>([...UNIVERSAL_ROLES, "raw"]);
  for (const [name, value] of Object.entries(row.entry)) {
    if (used.has(name)) continue;
    const when = typeof value === "string" && INSTANT.test(value) ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(when)) add(name, whenText(when, env));
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      add(name, String(value));
  }
  return { row, fields };
}
