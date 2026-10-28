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

export function validateMode(mode: Mode, all: Mode[]): string[] {
  const problems: string[] = [];
  const parent = mode.manifest.extends;
  if (parent !== null && parent !== "base") problems.push(`extends must be "base" or null`);
  if (mode.manifest.id === "base" && parent !== null) problems.push("base extends nothing");
  if (all.filter((m) => m.manifest.id === mode.manifest.id).length > 1)
    problems.push("duplicate id");
  return problems;
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

/** "Save to this mode": write every changed desktop into the mode's desktop files. */
export function saveInto(mode: Mode, session: Session): Mode {
  const desktops = { ...mode.desktops };
  for (const d of DESKTOPS) {
    const s = session[d];
    if (s) desktops[d] = structuredClone(s);
  }
  return {
    ...mode,
    desktops,
    manifest: { ...mode.manifest, version: bump(mode.manifest.version) },
  };
}

/** "Save as a new mode": the desk as it is now, under a new name. Only the name is asked. */
export function saveAsNew(
  mode: Mode,
  base: Mode | undefined,
  session: Session,
  name: string,
  author: string,
  taken: string[],
): Mode {
  const desktops: Mode["desktops"] = {};
  for (const d of DESKTOPS) desktops[d] = structuredClone(effectiveLayout(mode, base, d, session));
  return {
    ...structuredClone(mode),
    desktop: undefined,
    desktops,
    manifest: {
      id: uniqueId(name, taken),
      name,
      icon: mode.manifest.icon,
      author,
      version: "1.0.0",
      extends: "base",
    },
  };
}

/** Copy someone else's mode: keep the recipe, empty the agent bindings, remember where it came from. */
export function copyMode(mode: Mode, author: string, taken: string[]): Mode {
  const copy = structuredClone(mode);
  copy.roles = { roles: copy.roles.roles.map((r) => ({ role: r.role, agent: null })) };
  copy.manifest = {
    ...copy.manifest,
    id: uniqueId(mode.manifest.name, taken),
    author,
    copiedFrom: {
      author: mode.manifest.author,
      id: mode.manifest.id,
      version: mode.manifest.version,
    },
  };
  return copy;
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

function bump(version: string): string {
  const [major = "1", minor = "0"] = version.split(".");
  return `${major}.${Number(minor) + 1}.0`;
}
