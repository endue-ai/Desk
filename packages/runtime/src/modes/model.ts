/**
 * Layering and editing. Effective layout = base → mode → desktop override → unsaved session changes.
 * Desktops are named by id (ADR 0117); a number names one by its position in the mode's list.
 */
import { idAt, sameList } from "../desktops/model";
import type { Desktop, DesktopId, DesktopLayout, DesktopRef, Mode } from "./types";

export const EMPTY_DESKTOP: DesktopLayout = {
  surfaces: [],
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
};

/** The desktops moved since the profile was saved, by id. */
export type Session = Partial<Record<DesktopId, DesktopLayout>>;

function layer(a: DesktopLayout, b: Partial<DesktopLayout> | undefined): DesktopLayout {
  if (!b) return a;
  return {
    surfaces: b.surfaces ? b.surfaces.map((s) => ({ ...s })) : a.surfaces,
    eris: b.eris === undefined ? a.eris : b.eris,
    rail: { ...a.rail, ...b.rail },
    drawer: { ...a.drawer, ...b.drawer },
  };
}

/** A desktop's id in the mode: a number is a position in its list (the four's ids are their numbers). */
const idIn = (mode: Mode, desktop: DesktopRef): DesktopId =>
  typeof desktop === "number" ? (idAt(mode.list, desktop) ?? String(desktop)) : desktop;

/** The saved layout of one desktop: base, then the mode, then its desktop's own. */
export function savedLayout(
  mode: Mode,
  base: Mode | undefined,
  desktop: DesktopRef,
): DesktopLayout {
  const id = idIn(mode, desktop);
  let out = EMPTY_DESKTOP;
  if (mode.manifest.extends === "base" && base) {
    out = layer(layer(out, base.desktop), base.desktops[id]);
  }
  return layer(layer(out, mode.desktop), mode.desktops[id]);
}

export function effectiveLayout(
  mode: Mode,
  base: Mode | undefined,
  desktop: DesktopRef,
  session: Session,
): DesktopLayout {
  const id = idIn(mode, desktop);
  return session[id] ?? savedLayout(mode, base, id);
}

export function sameLayout(a: DesktopLayout, b: DesktopLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * True when the session moved something away from what the mode saved: a layout, or the list of
 * desktops (`list`, when the session changed it: added, renamed, removed or reordered).
 */
export function isDirty(
  mode: Mode,
  base: Mode | undefined,
  session: Session,
  list?: readonly Desktop[] | null,
): boolean {
  if (list && !sameList(list, mode.list)) return true;
  return Object.entries(session).some(
    ([id, s]) => s !== undefined && !sameLayout(s, savedLayout(mode, base, id)),
  );
}

/** Surfaces open now that the next mode does not place anywhere: they go to the drawer, not away. */
export function leftBehind(
  from: Mode,
  to: Mode,
  base: Mode | undefined,
  session: Session,
  list: readonly Desktop[] = from.list,
): DesktopLayout["surfaces"] {
  const kept = new Set(
    to.list.flatMap((d) => savedLayout(to, base, d.id).surfaces.map((s) => s.id)),
  );
  const seen = new Set<string>();
  return list
    .flatMap((d) => effectiveLayout(from, base, d.id, session).surfaces)
    .filter((s) => {
      if (kept.has(s.id) || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
}

export function uniqueId(name: string, taken: string[]): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "mode";
  let id = slug;
  for (let i = 2; taken.includes(id); i++) id = `${slug}-${i}`;
  return id;
}
