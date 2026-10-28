/** Everything the shell can do to the desk, as functions over the store. */
import type { ShellBridge } from "../bridge/types";
import {
  copyMode,
  EMPTY_DESKTOP,
  effectiveLayout,
  isDirty,
  leftBehind,
  saveAsNew,
  saveInto,
} from "../modes/model";
import type { DesktopIndex, DesktopLayout, Mode, SurfacePlacement } from "../modes/types";
import type { DeskState, Store } from "./state";

export interface Ctx {
  store: Store;
  bridge: ShellBridge;
  now(): number;
}

export const AUTHOR = "me";

export function modeOf(s: DeskState, id = s.modeId): Mode {
  return s.modes.find((m) => m.manifest.id === id) ?? (s.modes[1] as Mode);
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

/** Change the current desktop's layout as an unsaved session edit. */
export function edit(ctx: Ctx, change: (l: DesktopLayout) => DesktopLayout): void {
  ctx.store.set((s) => {
    const next = change(structuredClone(layoutOf(s)));
    return { session: { ...s.session, [s.desktop]: next } };
  });
}

export function moveSurface(ctx: Ctx, id: string, rect: Partial<SurfacePlacement>): void {
  edit(ctx, (l) => ({
    ...l,
    surfaces: l.surfaces.map((p) => (p.id === id ? { ...p, ...rect } : p)),
  }));
}

export function focusSurface(ctx: Ctx, id: string | null): void {
  if (ctx.store.get().focused !== id) ctx.store.set({ focused: id });
}

export function closeSurface(ctx: Ctx, id: string): void {
  edit(ctx, (l) => ({ ...l, surfaces: l.surfaces.filter((p) => p.id !== id) }));
}

export function togglePin(ctx: Ctx, id: string): void {
  edit(ctx, (l) => ({
    ...l,
    surfaces: l.surfaces.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)),
  }));
}

export function stash(ctx: Ctx, id: string): void {
  const placement = layoutOf(ctx.store.get()).surfaces.find((p) => p.id === id);
  if (!placement) return;
  closeSurface(ctx, id);
  ctx.store.set((s) => ({
    drawer: [
      { id: `surface-${id}`, kind: "surface", name: id, at: ctx.now(), placement },
      ...s.drawer.filter((d) => d.placement?.id !== id),
    ],
  }));
}

/** Default places, in the 1440×900 reference frame. The centre stays free unless the user moves things. */
export function defaultPlacement(id: string): SurfacePlacement {
  const base = { id, pinned: false };
  if (id === "calendar")
    return { ...base, plugin: "endue.calendar", x: 120, y: 240, w: 560, h: 400 };
  if (id === "tomorrow") return { ...base, plugin: "endue.eris", x: 1000, y: 220, w: 320, h: 360 };
  if (id === "notes") return { ...base, plugin: "endue.notes", x: 140, y: 260, w: 380, h: 300 };
  if (id.startsWith("agent:"))
    return { ...base, plugin: "endue.agent", x: 520, y: 300, w: 400, h: 300 };
  if (id.startsWith("recent:"))
    return { ...base, plugin: "endue.eris", x: 980, y: 300, w: 320, h: 240 };
  return { ...base, plugin: "endue.files", x: 980, y: 320, w: 320, h: 240 };
}

export function openSurface(ctx: Ctx, id: string, placement?: SurfacePlacement): void {
  const s = ctx.store.get();
  if (!layoutOf(s).surfaces.some((p) => p.id === id)) {
    edit(ctx, (l) => ({ ...l, surfaces: [...l.surfaces, placement ?? defaultPlacement(id)] }));
  }
  ctx.store.set((st) => ({
    focused: id,
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

/** Switch modes. Surfaces the next mode does not place go to the drawer instead of closing. */
export function switchMode(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  if (id === s.modeId || !s.modes.some((m) => m.manifest.id === id)) return;
  const sent = leftBehind(modeOf(s), modeOf(s, id), baseOf(s), s.session);
  ctx.store.set({
    modeId: id,
    session: {},
    popover: null,
    drawer: [
      ...sent.map((p) => ({
        id: `surface-${p.id}`,
        kind: "surface" as const,
        name: p.id,
        at: ctx.now(),
        placement: p,
      })),
      ...s.drawer.filter((d) => !sent.some((p) => p.id === d.placement?.id)),
    ],
  });
}

export function saveIntoMode(ctx: Ctx): void {
  ctx.store.set((s) => ({
    modes: s.modes.map((m) => (m.manifest.id === s.modeId ? saveInto(m, s.session) : m)),
    session: {},
    popover: null,
  }));
}

export function saveAsNewMode(ctx: Ctx, name: string): void {
  const s = ctx.store.get();
  const taken = s.modes.map((m) => m.manifest.id);
  const mode = saveAsNew(modeOf(s), baseOf(s), s.session, name.trim(), AUTHOR, taken);
  ctx.store.set({
    modes: [...s.modes, mode],
    modeId: mode.manifest.id,
    session: {},
    dialog: null,
    popover: null,
  });
}

export function copyFrom(ctx: Ctx, mode: Mode): void {
  ctx.store.set((s) => ({
    modes: [
      ...s.modes,
      copyMode(
        mode,
        AUTHOR,
        s.modes.map((m) => m.manifest.id),
      ),
    ],
  }));
}

export function revert(ctx: Ctx): void {
  ctx.store.set({ session: {}, popover: null });
}

export function setDesktop(ctx: Ctx, desktop: DesktopIndex): void {
  ctx.store.set({ desktop, focused: null });
}

export function moveEris(ctx: Ctx, pos: { x: number; y: number } | null): void {
  edit(ctx, (l) => ({ ...l, eris: pos }));
}

export function selectAgent(ctx: Ctx, id: string): void {
  ctx.store.set({ agentId: id });
  openSurface(ctx, `agent:${id}`);
}

export function selectSpace(ctx: Ctx, id: string): void {
  const space = ctx.store.get().spaces.find((sp) => sp.id === id);
  ctx.store.set({ spaceId: id, agentId: space?.agents[0]?.id ?? null });
}

export function desktopIsEmpty(s: DeskState, d: DesktopIndex): boolean {
  return layoutOf(s, d).surfaces.length === 0;
}

export { EMPTY_DESKTOP };
