/**
 * Desktops as a named, open-ended list (ADR 0117): each has a stable string id and a name, and its
 * position in the list is its index. These are the list's own operations, on plain arrays; the
 * desk's state applies them in `ops.ts`.
 */
import type { Desktop, DesktopId, DesktopIndex, DesktopRef } from "../modes/types";

/** No more desktops than this: past it the switcher and the overview stop being readable. */
export const MAX_DESKTOPS = 32;
/** A name longer than this is cut. */
export const NAME_LIMIT = 40;

/** The four a desk starts with, named 1 to 4 as the four-desktop desk numbered them. */
export const defaultDesktops = (): Desktop[] =>
  ["1", "2", "3", "4"].map((id) => ({ id, name: id }));

/** The id at a position (from 1) or the id itself when the list has it. */
export function idAt(list: readonly Desktop[], ref: DesktopRef | undefined): DesktopId | undefined {
  if (typeof ref === "number") return Number.isInteger(ref) ? list[ref - 1]?.id : undefined;
  return list.some((d) => d.id === ref) ? ref : undefined;
}

/** A desktop's position, from 1; 0 when the list does not have it. */
export const positionOf = (list: readonly Desktop[], id: DesktopId): DesktopIndex =>
  list.findIndex((d) => d.id === id) + 1;

/** A name as it is kept: one line, trimmed, at most NAME_LIMIT characters. */
export function cleanName(name: string): string {
  return [...name.replace(/\s+/g, " ").trim()].slice(0, NAME_LIMIT).join("").trim();
}

/**
 * An id no desktop has had: one more than the highest number among `taken` (the list's ids and any
 * a saved layout still uses), so a new desktop never inherits a removed one's windows.
 */
export function nextId(taken: Iterable<string>): DesktopId {
  let highest = 0;
  for (const id of taken) if (/^\d+$/.test(id)) highest = Math.max(highest, Number(id));
  return String(highest + 1);
}

/** The first number no desktop in the list is named. */
export function nextName(list: readonly Desktop[]): string {
  const names = new Set(list.map((d) => d.name));
  let n = 1;
  while (names.has(String(n))) n++;
  return String(n);
}

/** The list with a new desktop at the end, or undefined at the cap. */
export function added(
  list: readonly Desktop[],
  taken: Iterable<string>,
  name?: string,
): { list: Desktop[]; id: DesktopId } | undefined {
  if (list.length >= MAX_DESKTOPS) return undefined;
  const id = nextId([...list.map((d) => d.id), ...taken]);
  const clean = name === undefined ? "" : cleanName(name);
  return { list: [...list, { id, name: clean || nextName(list) }], id };
}

/** The list with one desktop renamed; an empty name leaves it as it was. */
export function renamed(list: readonly Desktop[], id: DesktopId, name: string): Desktop[] {
  const clean = cleanName(name);
  return list.map((d) => (d.id === id && clean ? { ...d, name: clean } : d));
}

/** The list without one desktop; the last one stays. */
export function removed(list: readonly Desktop[], id: DesktopId): Desktop[] {
  if (list.length <= 1) return [...list];
  return list.filter((d) => d.id !== id);
}

/** The list with one desktop moved to position `to` (from 1), clamped to the list. */
export function moved(list: readonly Desktop[], id: DesktopId, to: DesktopIndex): Desktop[] {
  const from = list.findIndex((d) => d.id === id);
  if (from < 0) return [...list];
  const rest = list.filter((d) => d.id !== id);
  const at = Math.max(0, Math.min(rest.length, Math.round(to) - 1));
  return [...rest.slice(0, at), list[from] as Desktop, ...rest.slice(at)];
}

/** Where a removed desktop's windows go: the desktop before it, or after it when it is first. */
export function neighbourOf(list: readonly Desktop[], id: DesktopId): DesktopId | undefined {
  const at = list.findIndex((d) => d.id === id);
  if (at < 0) return undefined;
  return (list[at - 1] ?? list[at + 1])?.id;
}

/** The desktop `step` places after (or before, when negative) `id`, round the list. */
export function stepFrom(list: readonly Desktop[], id: DesktopId, step: number): DesktopId {
  const at = Math.max(
    0,
    list.findIndex((d) => d.id === id),
  );
  const n = list.length;
  return (list[(((at + step) % n) + n) % n] ?? list[0])?.id ?? id;
}

export const sameList = (a: readonly Desktop[], b: readonly Desktop[]): boolean =>
  a.length === b.length && a.every((d, i) => d.id === b[i]?.id && d.name === b[i]?.name);

/** A list as stored, when it is one: unique non-empty ids, names, at least one, at most the cap. */
export function readList(value: unknown): Desktop[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: Desktop[] = [];
  for (const entry of value.slice(0, MAX_DESKTOPS)) {
    if (!entry || typeof entry !== "object") return undefined;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !id || out.some((d) => d.id === id)) return undefined;
    const clean = typeof name === "string" ? cleanName(name) : "";
    out.push({ id, name: clean || id });
  }
  return out;
}
