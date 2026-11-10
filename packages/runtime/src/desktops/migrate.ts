/**
 * The desktops as profiles keep them (ADR 0117): a `desktops` list, each entry with
 * its `id`, `name` and `layout`. What the four-desktop desk saved loads unchanged: it kept layouts by
 * desktop number, and the numbers are the ids of the four a desk starts with.
 */
import type { Desktop, DesktopId, DesktopLayout } from "../modes/types";
import { readList } from "./model";

/** One desktop as it is stored. */
export interface StoredDesktop {
  id: DesktopId;
  name: string;
  layout?: Partial<DesktopLayout>;
}

/** What a stored value says: the list, when it names one, and the layouts it holds, by id. */
export interface Stored<L> {
  list?: Desktop[];
  layouts: Record<DesktopId, L>;
}

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** A whole layout, as a session keeps one: at least its surfaces. */
const isLayout = (value: unknown): value is DesktopLayout =>
  isNode(value) && Array.isArray(value.surfaces);

function fromList<L>(entries: unknown[], keep: (layout: unknown) => layout is L): Stored<L> {
  const list = readList(entries);
  if (!list) return { layouts: {} };
  const layouts: Record<DesktopId, L> = {};
  for (const entry of entries) {
    const { id, layout } = (isNode(entry) ? entry : {}) as { id?: unknown; layout?: unknown };
    if (typeof id === "string" && list.some((d) => d.id === id) && keep(layout))
      layouts[id] = structuredClone(layout);
  }
  return { list, layouts };
}

function byNumber<L>(value: Node, keep: (layout: unknown) => layout is L): Stored<L> {
  const layouts: Record<DesktopId, L> = {};
  for (const [id, layout] of Object.entries(value))
    if (keep(layout)) layouts[id] = structuredClone(layout);
  return { layouts };
}

/** `desk.shell.mode`'s `desktops`: the list, or (before ADR 0117) partial layouts by number. */
export function readRecipe(value: unknown): Stored<Partial<DesktopLayout>> {
  if (Array.isArray(value)) return fromList(value, isNode as (v: unknown) => v is Node);
  return isNode(value) ? byNumber(value, isNode as (v: unknown) => v is Node) : { layouts: {} };
}

/** `desk.shell.layouts`: `{ desktops: [...] }`, or (before ADR 0117) whole layouts by number. */
export function readMoved(value: unknown): Stored<DesktopLayout> {
  if (!isNode(value)) return { layouts: {} };
  if (Array.isArray(value.desktops)) return fromList(value.desktops, isLayout);
  return byNumber(value, isLayout);
}

/** The list as it is stored, each desktop with its layout when it has one. */
export function writeList<L extends Partial<DesktopLayout>>(
  list: readonly Desktop[],
  layouts: Partial<Record<DesktopId, L>>,
): StoredDesktop[] {
  return list.map((d) => {
    const layout = layouts[d.id];
    return layout ? { id: d.id, name: d.name, layout: structuredClone(layout) } : { ...d };
  });
}
