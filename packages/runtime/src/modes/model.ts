/**
 * Layering and editing. Effective layout = base → mode → desktop override → unsaved session changes.
 */
import { DESKTOPS, type DesktopIndex, type DesktopLayout, type Mode } from "./types";

export const EMPTY_DESKTOP: DesktopLayout = {
  surfaces: [],
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
};

export type Session = Partial<Record<DesktopIndex, DesktopLayout>>;

function layer(a: DesktopLayout, b: Partial<DesktopLayout> | undefined): DesktopLayout {
  if (!b) return a;
  return {
    surfaces: b.surfaces ? b.surfaces.map((s) => ({ ...s })) : a.surfaces,
    eris: b.eris === undefined ? a.eris : b.eris,
    rail: { ...a.rail, ...b.rail },
    drawer: { ...a.drawer, ...b.drawer },
  };
}

/** The saved layout of one desktop: base, then the mode, then its desktop file. */
export function savedLayout(
  mode: Mode,
  base: Mode | undefined,
  desktop: DesktopIndex,
): DesktopLayout {
  let out = EMPTY_DESKTOP;
  if (mode.manifest.extends === "base" && base) {
    out = layer(layer(out, base.desktop), base.desktops[desktop]);
  }
  return layer(layer(out, mode.desktop), mode.desktops[desktop]);
}

export function effectiveLayout(
  mode: Mode,
  base: Mode | undefined,
  desktop: DesktopIndex,
  session: Session,
): DesktopLayout {
  return session[desktop] ?? savedLayout(mode, base, desktop);
}

export function sameLayout(a: DesktopLayout, b: DesktopLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when the session moved something away from what the mode saved. */
export function isDirty(mode: Mode, base: Mode | undefined, session: Session): boolean {
  return DESKTOPS.some((d) => {
    const s = session[d];
    return s !== undefined && !sameLayout(s, savedLayout(mode, base, d));
  });
}

/** Surfaces open now that the next mode does not place anywhere: they go to the drawer, not away. */
export function leftBehind(
  from: Mode,
  to: Mode,
  base: Mode | undefined,
  session: Session,
): DesktopLayout["surfaces"] {
  const kept = new Set(DESKTOPS.flatMap((d) => savedLayout(to, base, d).surfaces.map((s) => s.id)));
  const seen = new Set<string>();
  return DESKTOPS.flatMap((d) => effectiveLayout(from, base, d, session).surfaces).filter((s) => {
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
