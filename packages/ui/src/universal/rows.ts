// Entries as rows: each entry of a universal data document (specs/view/v0/universal.schema.json) with
// the fields that play the roles the views draw read through the map, times resolved in the view's
// zone. Pure: the element and the tests share it.
import type { UniversalData, UniversalEntry, UniversalMap } from "@endue-ai/bridge";
import { addDays, dayStart, whenOf } from "./time";

/** The roles a map can name. */
export const UNIVERSAL_ROLES = [
  "id",
  "title",
  "text",
  "detail",
  "start",
  "end",
  "group",
  "author",
  "role",
  "status",
  "tags",
  "url",
] as const;

/** A step's or a task's state, as the views colour it. */
export type UniversalTone = "pending" | "running" | "done" | "failed" | "waiting" | "other";

/** One entry with its roles read. */
export interface UniversalRow {
  /** Unique among the rows: the entry's id, else its position; a repeated id gets #2, #3. */
  key: string;
  /** Where the entry is in the data. */
  index: number;
  id: string;
  title: string;
  /** Markdown. */
  text: string;
  detail: string;
  /** Milliseconds since the epoch; a whole day starts at its midnight in the zone. */
  start?: number;
  /** Exclusive: a whole-day end is the midnight after its last day. */
  end?: number;
  /** Whether start was a whole day (YYYY-MM-DD). */
  allDay: boolean;
  /** The column of a board: "" when the entry has none. */
  group: string;
  author: string;
  role: string;
  /** Lowercase, as written. */
  status: string;
  tone: UniversalTone;
  tags: string[];
  url: string;
  /** The entry as the source gave it, for actions and templates. */
  entry: UniversalEntry;
}

/** The value at a dotted path (raw.owner, tags.0), or undefined. */
export function valueAt(value: unknown, path: string): unknown {
  let at: unknown = value;
  for (const part of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/** A copy of `value` with the dotted path set, making the objects on the way. */
export function withValueAt<T extends object>(value: T, path: string, next: unknown): T {
  const [head = "", ...rest] = path.split(".");
  const copy: Record<string, unknown> = Array.isArray(value)
    ? ([...value] as unknown as Record<string, unknown>)
    : { ...(value as Record<string, unknown>) };
  if (rest.length === 0) copy[head] = next;
  else {
    const inner = copy[head];
    copy[head] = withValueAt(inner && typeof inner === "object" ? inner : {}, rest.join("."), next);
  }
  return copy as T;
}

/** A value as one line of text: strings as they are, numbers and booleans written out. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.join(", ");
  return "";
}

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean);
  const one = textOf(value);
  return one ? [one] : [];
}

const TONES: Record<string, UniversalTone> = {};
for (const [tone, words] of Object.entries({
  pending: "pending queued todo to-do open planned new backlog",
  running: "running active in-progress in_progress doing working thinking started",
  done: "done complete completed success succeeded ok closed finished resolved",
  failed: "failed failure error errored broken",
  waiting: "waiting blocked paused needs-input needs_input approval review",
})) {
  for (const word of words.split(" ")) TONES[word] = tone as UniversalTone;
}

/** The tone of a status word. */
export const toneOf = (status: string): UniversalTone =>
  TONES[status.trim().toLowerCase()] ?? "other";

/** The map in force: the data's own, then the view's on top. */
export function mapOf(data: UniversalData | null | undefined, map?: UniversalMap): UniversalMap {
  return { ...(data?.map ?? {}), ...(map ?? {}) };
}

/** The rows of a document's entries, in their order. */
export function rowsOf(
  data: UniversalData | null | undefined,
  options: { map?: UniversalMap; zone?: string } = {},
): UniversalRow[] {
  const map = mapOf(data, options.map);
  const seen = new Map<string, number>();
  return (data?.entries ?? []).map((entry, index) => {
    const read = (role: (typeof UNIVERSAL_ROLES)[number]) => valueAt(entry, map[role] ?? role);
    const id = textOf(read("id"));
    const base = id || String(index + 1);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const start = whenOf(read("start"), options.zone);
    const endValue = read("end");
    const endWhen = whenOf(endValue, options.zone);
    // A whole-day end is its last day: the row ends at the midnight after it.
    let end = endWhen?.day ? dayStart(addDays(endWhen.day, 1), options.zone) : endWhen?.at;
    if (end === undefined && start?.day) end = dayStart(addDays(start.day, 1), options.zone);
    if (start && end !== undefined && end < start.at) end = undefined;
    const status = textOf(read("status")).trim().toLowerCase();
    return {
      key: count === 1 ? base : `${base}#${count}`,
      index,
      id,
      title: textOf(read("title")),
      text: textOf(read("text")),
      detail: textOf(read("detail")),
      ...(start ? { start: start.at } : {}),
      ...(start && end !== undefined ? { end } : {}),
      allDay: start?.day !== undefined,
      group: textOf(read("group")),
      author: textOf(read("author")),
      role: textOf(read("role")).trim().toLowerCase(),
      status,
      tone: toneOf(status),
      tags: tagsOf(read("tags")),
      url: textOf(read("url")),
      entry,
    };
  });
}

/**
 * The document after a row moved to another group: its entry's group field (through the map) set
 * to `group`. Other entries are the same objects.
 */
export function movedTo(
  data: UniversalData,
  row: Pick<UniversalRow, "index">,
  group: string,
  map?: UniversalMap,
): UniversalData {
  const path = mapOf(data, map).group ?? "group";
  const entries = data.entries.map((entry, index) =>
    index === row.index ? withValueAt(entry, path, group) : entry,
  );
  return { ...data, entries };
}

/** Rows in time order (undated ones last, in their order), earliest first unless `desc`. */
export function byStart(rows: UniversalRow[], order: "asc" | "desc" = "asc"): UniversalRow[] {
  const sign = order === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.start === undefined || b.start === undefined)
      return a.start === b.start ? a.index - b.index : a.start === undefined ? 1 : -1;
    return sign * (a.start - b.start) || Number(b.allDay) - Number(a.allDay) || a.index - b.index;
  });
}
