/**
 * Desktops as a named, open-ended list (ADR 0117): each has a stable string id and a name, and its
 * position in the list is its index. Reading a list (the profiles' records, the one the window
 * manager publishes); adding, renaming, removing and reordering desktops are the window manager's
 * (crates/desk-wm `desktops.rs`, #83).
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

/** Where a removed desktop's windows go: the desktop before it, or after it when it is first. */
export function neighbourOf(list: readonly Desktop[], id: DesktopId): DesktopId | undefined {
  const at = list.findIndex((d) => d.id === id);
  if (at < 0) return undefined;
  return (list[at - 1] ?? list[at + 1])?.id;
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
