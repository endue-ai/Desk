/** Everything the shell can do to the desk, as functions over the store and the runtime. */
import type { ShellBridge } from "../bridge/types";
import { readMoved, writeList } from "../desktops/migrate";
import { idAt, positionOf, sameList } from "../desktops/model";
import { runGesture } from "../gesture";
import { effectiveLayout, isDirty, leftBehind, uniqueId } from "../modes/model";
import { LAYOUTS, MODE, recipeOf } from "../modes/profiles";
import type {
  Desktop,
  DesktopId,
  DesktopLayout,
  DesktopRef,
  Mode,
  SurfacePlacement,
} from "../modes/types";
import type { Runtime } from "../runtime";
import { isFloating } from "../surface/coordinates";
import { slotRect } from "../surface/tiling";
import { leaves, panesOf } from "../surface/tree";
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

/** The desktops in order (ADR 0117): as the person changed them, else as the profile saved them. */
export function desktopsOf(s: DeskState): Desktop[] {
  return s.desktops ?? modeOf(s).list;
}

/** A desktop's id: by id or position (from 1); the first desktop for one the list does not have. */
export function desktopId(s: DeskState, desktop: DesktopRef = s.desktop): DesktopId {
  const list = desktopsOf(s);
  return idAt(list, desktop) ?? list[0]?.id ?? "1";
}

export function layoutOf(s: DeskState, desktop: DesktopRef = s.desktop): DesktopLayout {
  return effectiveLayout(modeOf(s), baseOf(s), desktopId(s, desktop), s.session);
}

export function dirty(s: DeskState): boolean {
  return isDirty(modeOf(s), baseOf(s), s.session, s.desktops);
}

/**
 * Plugin surfaces the runtime handed over that no layout places and the drawer does not hold: each
 * in its own slot (`surface/tiling.ts`), until the person moves or resizes one (ADR 0040). A slot
 * does not depend on the other windows, so none of them moves when one of these does.
 */
export function autoPlacements(s: DeskState, desktop: DesktopRef = s.desktop): SurfacePlacement[] {
  const here = desktopId(s, desktop);
  const placed = new Set(layoutOf(s, here).surfaces.map((p) => p.plugin));
  const away = new Set(s.drawer.map((d) => d.placement?.plugin));
  // A plugin window placed on another desktop (moved, resized or sent there) lives there (ADR 0117).
  const elsewhere = new Set(
    desktopsOf(s)
      .filter((d) => d.id !== here)
      .flatMap((d) => layoutOf(s, d.id).surfaces.map((p) => p.id)),
  );
  return s.adopted.flatMap((a, i) => {
    if (placed.has(a.id) || away.has(a.id) || elsewhere.has(a.id)) return [];
    // A normal window: its slot on screen as the canvas was when it arrived, then on the canvas.
    const rect = slotRect(a.slot ?? i);
    const at = a.at ?? { x: 0, y: 0 };
    return [
      {
        id: a.id,
        plugin: a.id,
        ...rect,
        x: rect.x - at.x,
        y: rect.y - at.y,
        pinned: false,
        panes: { kind: "view" as const, id: "p1", view: `plugin:${a.id}` },
      },
    ];
  });
}

/**
 * A placed window that shows nothing but plugins the runtime does not hold now (one that closed
 * itself, was turned off, or has not mounted yet) is not drawn: an empty window is no window. It
 * keeps its place in the layout and comes back there when its plugin mounts again.
 */
function showsSomething(s: DeskState, p: SurfacePlacement): boolean {
  return leaves(panesOf(p)).some((leaf) => {
    if (!leaf.view.startsWith("plugin:")) return true;
    const id = leaf.view.slice("plugin:".length);
    return s.adopted.some((a) => a.id === id);
  });
}

/** Every window on a desktop: what the layout places, then the plugin surfaces in their slots. */
export function windowsOf(s: DeskState, desktop: DesktopRef = s.desktop): SurfacePlacement[] {
  return [
    ...layoutOf(s, desktop).surfaces.filter((p) => showsSomething(s, p)),
    ...autoPlacements(s, desktop),
  ];
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
  editAt(ctx, ctx.store.get().desktop, change);
}

/** Change one desktop's layout as an unsaved session edit. */
export function editAt(
  ctx: Ctx,
  desktop: DesktopRef,
  change: (l: DesktopLayout) => DesktopLayout,
): void {
  ctx.store.set((s) => {
    const id = desktopId(s, desktop);
    return { session: { ...s.session, [id]: change(structuredClone(layoutOf(s, id))) } };
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

/**
 * A new normal window opens where the person is looking: its place on screen, as canvas coordinates
 * at the current pan. A floating one is already in the screen's frame.
 */
export function inView(s: DeskState, p: SurfacePlacement): SurfacePlacement {
  if (isFloating(p)) return p;
  const pan = s.pan[desktopId(s)] ?? { x: 0, y: 0 };
  return { ...p, x: p.x - pan.x, y: p.y - pan.y };
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
  if (id.startsWith("local:"))
    return { ...base, plugin: "desk.agents", x: 360, y: 120, w: 820, h: 600 };
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
      surfaces: [...l.surfaces, cascade(placement ?? inView(s, defaultPlacement(id)), l.surfaces)],
    }));
  }
  // Placed now, it leaves the drawer by the store's rule (away.ts).
  ctx.store.set({ focused: id, pane: null });
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
  void runGesture(ctx.runtime, "desk.profiles.switch", { id });
}

/**
 * Another profile is in force. Surfaces the next one does not place go to the drawer instead of
 * closing, and the desktops moved under the last one are dropped. The desk stays on the same
 * desktop when the next profile has it, else on the same position.
 */
export function switched(ctx: Ctx, modes: Mode[], id: string): void {
  const s = ctx.store.get();
  const next = { ...s, modes };
  const from = s.modes.find((m) => m.manifest.id === s.modeId);
  const to = modeOf(next, id);
  const sent =
    id === s.modeId || !from ? [] : leftBehind(from, to, baseOf(next), s.session, desktopsOf(s));
  if (id !== s.modeId) ctx.runtime.settings.reset(LAYOUTS);
  const moved = movedOf(ctx, to);
  const list = moved.desktops ?? to.list;
  const here = desktopId(s);
  const desktop =
    idAt(list, here) ?? idAt(list, Math.min(positionOf(desktopsOf(s), here), list.length)) ?? here;
  ctx.store.set({
    modes,
    modeId: id,
    ...moved,
    desktop,
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

/** The desktops' layouts moved since the profile was saved: the session layer of desk.shell.layouts. */
export function sessionOf(ctx: Ctx): DeskState["session"] {
  return readMoved(ctx.runtime.settings.layer("session")[LAYOUTS]).layouts;
}

/**
 * What the session layer of desk.shell.layouts says changed under `mode`: the layouts moved and the
 * list of desktops, null when it is the profile's own (ADR 0117).
 */
export function movedOf(
  ctx: Ctx,
  mode: Mode = modeOf(ctx.store.get()),
): Pick<DeskState, "session" | "desktops"> {
  const { list, layouts } = readMoved(ctx.runtime.settings.layer("session")[LAYOUTS]);
  return { session: layouts, desktops: list && !sameList(list, mode.list) ? list : null };
}

/** "Save to this profile": desk.profiles keeps the moved desktops in it, one version on. */
export function saveIntoMode(ctx: Ctx): void {
  const s = ctx.store.get();
  const mode = modeOf(s);
  const [major = "1", minor = "0"] = mode.manifest.version.split(".");
  ctx.runtime.settings.set(MODE, { ...recipeOf(mode), version: `${major}.${Number(minor) + 1}.0` });
  ctx.store.set({ popover: null });
  void runGesture(ctx.runtime, "desk.profiles.save", { id: s.modeId, name: mode.manifest.name });
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
  const list = desktopsOf(s);
  const desktops = writeList(
    list,
    Object.fromEntries(list.map((d) => [d.id, effectiveLayout(mode, baseOf(s), d.id, s.session)])),
  );
  ctx.runtime.settings.set(MODE, { ...recipe, author: AUTHOR, version: "1.0.0", desktops });
  ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set({ dialog: null, popover: null });
  void runGesture(ctx.runtime, "desk.profiles.save", { id, name: name.trim() });
}

/** Put the moved desktops back as the profile saved them, and its list of desktops. */
export function revert(ctx: Ctx): void {
  ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set((s) => {
    const list = modeOf(s).list;
    const here = desktopId(s);
    const desktop = idAt(list, here) ?? list[0]?.id ?? here;
    return { session: {}, desktops: null, desktop, popover: null };
  });
}

/** Bring a desktop to the front; the window in use on the one left is kept for coming back. */
export function setDesktop(ctx: Ctx, desktop: DesktopRef): void {
  ctx.store.set((s) => {
    const from = desktopId(s);
    const { [from]: _left, ...focusBy } = s.focusBy;
    if (s.focused) focusBy[from] = { window: s.focused, pane: s.pane };
    return { desktop: desktopId(s, desktop), focused: null, pane: null, focusBy };
  });
}

export function moveEris(ctx: Ctx, pos: { x: number; y: number } | null): void {
  edit(ctx, (l) => ({ ...l, eris: pos }));
}

export function desktopIsEmpty(s: DeskState, d: DesktopRef): boolean {
  return layoutOf(s, d).surfaces.length === 0;
}
