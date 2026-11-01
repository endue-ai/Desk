/** Everything the shell can do to the desk, as functions over the store and the runtime. */
import type { ShellBridge } from "../bridge/types";
import { effectiveLayout, isDirty, leftBehind, uniqueId } from "../modes/model";
import { LAYOUTS, MODE, recipeOf } from "../modes/profiles";
import {
  DESKTOPS,
  type DesktopIndex,
  type DesktopLayout,
  type Mode,
  type SurfacePlacement,
} from "../modes/types";
import type { Runtime } from "../runtime";
import { tiles } from "../surface/tiling";
import type { DeskState, Store } from "./state";
import { surfaceTitle, type Titled } from "./titles";

export interface Ctx extends Titled {
  store: Store;
  bridge: ShellBridge;
  /** The desk under the shell: commands, settings, profiles. */
  runtime: Runtime;
  now(): number;
  /** Wall-clock milliseconds now, for what is kept across a relaunch (the drawer's ages). */
  wall(): number;
}

export const AUTHOR = "me";

export function modeOf(s: DeskState, id = s.modeId): Mode {
  return s.modes.find((m) => m.manifest.id === id) ?? ((s.modes[1] ?? s.modes[0]) as Mode);
}

export function baseOf(s: DeskState): Mode | undefined {
  return s.modes.find((m) => m.manifest.id === "base");
}

export function layoutOf(s: DeskState, desktop: DesktopIndex = s.desktop): DesktopLayout {
  return effectiveLayout(modeOf(s), baseOf(s), desktop, s.session);
}

export function dirty(s: DeskState): boolean {
  return isDirty(modeOf(s), baseOf(s), s.session);
}

/**
 * Plugin surfaces the runtime handed over that no layout places and the drawer does not hold:
 * tiled in the free area in mount order, until the person moves or resizes one (ADR 0040).
 */
export function autoPlacements(
  s: DeskState,
  desktop: DesktopIndex = s.desktop,
): SurfacePlacement[] {
  const placed = new Set(layoutOf(s, desktop).surfaces.map((p) => p.plugin));
  const away = new Set(s.drawer.map((d) => d.placement?.plugin));
  const free = s.adopted.filter((a) => !placed.has(a.id) && !away.has(a.id));
  const rects = tiles(free.length);
  return free.flatMap((a, i) => {
    const rect = rects[i];
    if (!rect) return [];
    return [
      {
        id: a.id,
        plugin: a.id,
        ...rect,
        pinned: false,
        panes: { kind: "view" as const, id: "p1", view: `plugin:${a.id}` },
      },
    ];
  });
}

/** Every window on a desktop: what the layout places, then the tiled plugin surfaces. */
export function windowsOf(s: DeskState, desktop: DesktopIndex = s.desktop): SurfacePlacement[] {
  return [...layoutOf(s, desktop).surfaces, ...autoPlacements(s, desktop)];
}

/** A tiled plugin window enters the layout as it is before an edit (a move, a pin, a split). */
export function ensurePlaced(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  if (layoutOf(s).surfaces.some((p) => p.id === id)) return;
  const auto = autoPlacements(s).find((p) => p.id === id);
  if (auto) edit(ctx, (l) => ({ ...l, surfaces: [...l.surfaces, auto] }));
}

/** Change the current desktop's layout as an unsaved session edit. */
export function edit(ctx: Ctx, change: (l: DesktopLayout) => DesktopLayout): void {
  ctx.store.set((s) => {
    const next = change(structuredClone(layoutOf(s)));
    return { session: { ...s.session, [s.desktop]: next } };
  });
}

export function moveSurface(ctx: Ctx, id: string, rect: Partial<SurfacePlacement>): void {
  ensurePlaced(ctx, id);
  edit(ctx, (l) => ({
    ...l,
    surfaces: l.surfaces.map((p) => (p.id === id ? { ...p, ...rect } : p)),
  }));
}

export function closeSurface(ctx: Ctx, id: string): void {
  edit(ctx, (l) => ({ ...l, surfaces: l.surfaces.filter((p) => p.id !== id) }));
}

export function togglePin(ctx: Ctx, id: string): void {
  ensurePlaced(ctx, id);
  edit(ctx, (l) => ({
    ...l,
    surfaces: l.surfaces.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)),
  }));
}

/** Put a surface away in the drawer under its title (the title bar's, when the caller has it). */
export function stash(ctx: Ctx, id: string, name = surfaceTitle(ctx, id)): void {
  ensurePlaced(ctx, id);
  const placement = layoutOf(ctx.store.get()).surfaces.find((p) => p.id === id);
  if (!placement) return;
  closeSurface(ctx, id);
  ctx.store.set((s) => ({
    drawer: [
      { id: `surface-${id}`, kind: "surface", name, at: ctx.wall(), placement },
      ...s.drawer.filter((d) => d.placement?.id !== id),
    ],
  }));
}

/** A place not already taken by another surface at exactly the same spot: the next one steps down. */
function cascade(placement: SurfacePlacement, others: SurfacePlacement[]): SurfacePlacement {
  let { x, y } = placement;
  while (others.some((o) => o.x === x && o.y === y)) {
    x += 24;
    y += 24;
  }
  return { ...placement, x, y };
}

/** Default places, in the 1440×900 reference frame. The centre stays free unless the user moves things. */
export function defaultPlacement(id: string): SurfacePlacement {
  const base = { id, pinned: false };
  if (id === "calendar")
    return { ...base, plugin: "endue.calendar", x: 120, y: 240, w: 560, h: 400 };
  if (id === "tomorrow") return { ...base, plugin: "endue.eris", x: 1000, y: 220, w: 320, h: 360 };
  if (id === "notes") return { ...base, plugin: "endue.notes", x: 140, y: 260, w: 380, h: 300 };
  if (id.startsWith("agent:"))
    return { ...base, plugin: "endue.agent", x: 520, y: 260, w: 400, h: 340 };
  if (id === "keys") return { ...base, plugin: "endue.keys", x: 480, y: 200, w: 480, h: 440 };
  if (id.startsWith("recent:"))
    return { ...base, plugin: "endue.eris", x: 980, y: 300, w: 320, h: 240 };
  return { ...base, plugin: "endue.files", x: 980, y: 320, w: 320, h: 240 };
}

export function openSurface(ctx: Ctx, id: string, placement?: SurfacePlacement): void {
  const s = ctx.store.get();
  if (!layoutOf(s).surfaces.some((p) => p.id === id)) {
    edit(ctx, (l) => ({
      ...l,
      surfaces: [...l.surfaces, cascade(placement ?? defaultPlacement(id), l.surfaces)],
    }));
  }
  ctx.store.set((st) => ({
    focused: id,
    pane: null,
    drawer: st.drawer.filter((d) => d.placement?.id !== id),
  }));
}

export function raise(ctx: Ctx, itemId: string): void {
  const item = ctx.store.get().drawer.find((d) => d.id === itemId);
  if (!item) return;
  const id =
    item.placement?.id ?? (item.kind === "recent" ? `recent:${item.id}` : `file:${item.name}`);
  ctx.store.set((s) => ({ drawer: s.drawer.filter((d) => d.id !== itemId), popover: null }));
  openSurface(ctx, id, item.placement);
}

/** Switch profiles through desk.profiles; `switched` below follows whoever switched. */
export function switchMode(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  if (id === s.modeId || !s.modes.some((m) => m.manifest.id === id)) return;
  ctx.store.set({ popover: null });
  void ctx.runtime.commands.run("desk.profiles.switch", { id }).catch(() => {});
}

/**
 * Another profile is in force. Surfaces the next one does not place go to the drawer instead of
 * closing, and the desktops moved under the last one are dropped.
 */
export function switched(ctx: Ctx, modes: Mode[], id: string): void {
  const s = ctx.store.get();
  const next = { ...s, modes };
  const from = s.modes.find((m) => m.manifest.id === s.modeId);
  const sent =
    id === s.modeId || !from ? [] : leftBehind(from, modeOf(next, id), baseOf(next), s.session);
  if (id !== s.modeId) ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set({
    modes,
    modeId: id,
    session: sessionOf(ctx),
    drawer: [
      ...sent.map((p) => ({
        id: `surface-${p.id}`,
        kind: "surface" as const,
        name: surfaceTitle(ctx, p.id),
        at: ctx.wall(),
        placement: p,
      })),
      ...s.drawer.filter((d) => !sent.some((p) => p.id === d.placement?.id)),
    ],
  });
}

/** The desktops moved since the profile was saved: the session layer of desk.shell.layouts. */
export function sessionOf(ctx: Ctx): DeskState["session"] {
  const value = ctx.runtime.settings.layer("session")[LAYOUTS];
  return value && typeof value === "object" ? structuredClone(value as DeskState["session"]) : {};
}

/** "Save to this profile": desk.profiles keeps the moved desktops in it, one version on. */
export function saveIntoMode(ctx: Ctx): void {
  const s = ctx.store.get();
  const mode = modeOf(s);
  const [major = "1", minor = "0"] = mode.manifest.version.split(".");
  ctx.runtime.settings.set(MODE, { ...recipeOf(mode), version: `${major}.${Number(minor) + 1}.0` });
  ctx.store.set({ popover: null });
  void ctx.runtime.commands
    .run("desk.profiles.save", { id: s.modeId, name: mode.manifest.name })
    .catch(() => {});
}

/** "Save as a new profile": the desk as it is now, under a new name. Only the name is asked. */
export function saveAsNewMode(ctx: Ctx, name: string): void {
  const s = ctx.store.get();
  const mode = modeOf(s);
  const id = uniqueId(
    name.trim(),
    s.modes.map((m) => m.manifest.id),
  );
  // Every desktop as laid out now, written by this person; nothing left to the mode it came from.
  const { copiedFrom: _from, desktop: _desktop, ...recipe } = recipeOf(mode);
  const desktops = Object.fromEntries(
    DESKTOPS.map((d) => [d, effectiveLayout(mode, baseOf(s), d, s.session)]),
  );
  ctx.runtime.settings.set(MODE, { ...recipe, author: AUTHOR, version: "1.0.0", desktops });
  ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set({ dialog: null, popover: null });
  void ctx.runtime.commands.run("desk.profiles.save", { id, name: name.trim() }).catch(() => {});
}

/** Put the moved desktops back as the profile saved them. */
export function revert(ctx: Ctx): void {
  ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set({ session: {}, popover: null });
}

export function setDesktop(ctx: Ctx, desktop: DesktopIndex): void {
  ctx.store.set({ desktop, focused: null, pane: null });
}

export function moveEris(ctx: Ctx, pos: { x: number; y: number } | null): void {
  edit(ctx, (l) => ({ ...l, eris: pos }));
}

export function desktopIsEmpty(s: DeskState, d: DesktopIndex): boolean {
  return layoutOf(s, d).surfaces.length === 0;
}
