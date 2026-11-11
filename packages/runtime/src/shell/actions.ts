/**
 * Everything the shell can do to the desk, as functions over the store and the runtime. The
 * windows, panes, desktops, the drawer and the pan are the window manager's (crates/desk-wm, #83):
 * reads come from the desk it published last (`s.wm`), and every change is an edit it applies
 * (`wm/types.ts`). The profiles stay the runtime's: it lays the one in force out for desk-wm
 * (`savedOf`).
 */
import type { ShellBridge } from "../bridge/types";
import { runGesture } from "../gesture";
import { savedLayout, uniqueId } from "../modes/model";
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
import type { WindowManagerHost } from "../wm/host";
import type { Edit, Saved } from "../wm/types";
import { idAt, layoutIn } from "../wm/view";
import type { DeskState, Store } from "./state";
import { surfaceTitle, type Titled } from "./titles";

export interface Ctx extends Titled {
  store: Store;
  bridge: ShellBridge;
  /** The desk under the shell: commands, settings, profiles. */
  runtime: Runtime;
  /** The window manager every change of the windows goes to (#83). */
  wm: WindowManagerHost;
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

/** What a profile saves, layered over the base, as the window manager reads it (`Saved`). */
export function savedOf(mode: Mode, base: Mode | undefined): Saved {
  const ids = new Set([
    ...mode.list.map((d) => d.id),
    ...Object.keys(mode.desktops),
    ...(mode.manifest.extends === "base" ? Object.keys(base?.desktops ?? {}) : []),
  ]);
  return {
    list: mode.list,
    // What a desktop no recipe names starts from: an id no desktop can have.
    desktop: savedLayout(mode, base, "\u0000"),
    desktops: Object.fromEntries([...ids].map((id) => [id, savedLayout(mode, base, id)])),
  };
}

/** The desktops in order (ADR 0117), as the window manager has them. */
export function desktopsOf(s: DeskState): Desktop[] {
  return s.wm.desktops;
}

/** A desktop's id: by id or position (from 1); the first desktop for one the list does not have. */
export function desktopId(s: DeskState, desktop: DesktopRef = s.desktop): DesktopId {
  const list = desktopsOf(s);
  return idAt(list, desktop) ?? list[0]?.id ?? "1";
}

/** A desktop's layout as drawn: the session's moves, else the profile's. */
export function layoutOf(s: DeskState, desktop: DesktopRef = s.desktop): DesktopLayout {
  return layoutIn(s.wm, desktopId(s, desktop));
}

/** The session moved something from what the profile in force saved. */
export function dirty(s: DeskState): boolean {
  return s.wm.dirty;
}

/** Every window on a desktop: the plugin windows in their slots, then what its layout places. */
export function windowsOf(s: DeskState, desktop: DesktopRef = s.desktop): SurfacePlacement[] {
  return s.wm.windows[desktopId(s, desktop)] ?? [];
}

/** Ask the window manager for `edits`; their answers once the desk they made is in. */
export function edit(ctx: Pick<Ctx, "wm">, ...edits: Edit[]): Promise<unknown[]> {
  return ctx.wm.edit(edits);
}

export function togglePin(ctx: Ctx, id: string): Promise<unknown[]> {
  return edit(ctx, { op: "toggle-pin", id });
}

/** Put a surface away in the drawer under its title (the title bar's, when the caller has it). */
export function stash(ctx: Ctx, id: string, name = surfaceTitle(ctx, id)): Promise<unknown[]> {
  return edit(ctx, { op: "put-away", id, name, now: Math.round(ctx.wall()) });
}

/** Open window `id` on the desktop in front, at `placement` or its default place, focused. */
export function openSurface(
  ctx: Ctx,
  id: string,
  placement?: SurfacePlacement,
): Promise<unknown[]> {
  return edit(ctx, { op: "open", id, ...(placement ? { placement } : {}) });
}

export function raise(ctx: Ctx, itemId: string): Promise<unknown[]> {
  ctx.store.set({ popover: null });
  return edit(ctx, { op: "bring-back", item: itemId });
}

/** Switch profiles through desk.profiles; `switched` below follows whoever switched. */
export function switchMode(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  if (id === s.modeId || !s.modes.some((m) => m.manifest.id === id)) return;
  ctx.store.set({ popover: null });
  void runGesture(ctx.runtime, "desk.profiles.switch", { id });
}

/** desk.shell.layouts' session layer: the desktops moved under the profile in force. */
export const movedValue = (ctx: Pick<Ctx, "runtime">): unknown =>
  ctx.runtime.settings.layer("session")[LAYOUTS] ?? null;

/**
 * Another profile is in force, or the one in force was laid out again. The window manager sends
 * the windows the next one does not place to the drawer instead of closing them and drops the
 * desktops moved under the last one; the desk stays on the same desktop when the next profile has
 * it, else on the same position.
 */
export function switched(ctx: Ctx, modes: Mode[], id: string): Promise<unknown[]> {
  const s = ctx.store.get();
  const next = { ...s, modes };
  const from = s.modes.find((m) => m.manifest.id === s.modeId);
  const saved = savedOf(modeOf(next, id), baseOf(next));
  const another = id !== s.modeId && from !== undefined;
  const titles = Object.fromEntries(s.wm.ids.map((window) => [window, surfaceTitle(ctx, window)]));
  const now = Math.round(ctx.wall());
  const laid: Edit = another
    ? { op: "switch-profile", saved, titles, now }
    : { op: "saved", saved };
  ctx.store.set({ modes, modeId: id });
  // The switch goes first: it reads the desktops as the last profile's session left them, which
  // resetting desk.shell.layouts below clears.
  const switching = edit(ctx, laid);
  if (id !== s.modeId) ctx.runtime.settings.reset(LAYOUTS);
  const moved = edit(ctx, { op: "moved", value: movedValue(ctx) });
  return Promise.all([switching, moved]).then(([a, b]) => [...a, ...b]);
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
  const desktops = desktopsOf(s).map((d) => ({ ...d, layout: layoutOf(s, d.id) }));
  ctx.runtime.settings.set(MODE, { ...recipe, author: AUTHOR, version: "1.0.0", desktops });
  ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set({ dialog: null, popover: null });
  void runGesture(ctx.runtime, "desk.profiles.save", { id, name: name.trim() });
}

/** Put the moved desktops back as the profile saved them, and its list. */
export function revert(ctx: Ctx): Promise<unknown[]> {
  ctx.runtime.settings.reset(LAYOUTS);
  ctx.store.set({ popover: null });
  return edit(ctx, { op: "revert" });
}

/** Bring a desktop to the front; the window in use on the one left is kept for coming back. */
export function setDesktop(ctx: Ctx, desktop: DesktopRef): Promise<unknown[]> {
  return edit(ctx, { op: "set-desktop", desktop });
}

export function moveEris(ctx: Ctx, pos: { x: number; y: number } | null): Promise<unknown[]> {
  return edit(ctx, { op: "move-eris", at: pos });
}

export function desktopIsEmpty(s: DeskState, d: DesktopRef): boolean {
  return layoutOf(s, d).surfaces.length === 0;
}
