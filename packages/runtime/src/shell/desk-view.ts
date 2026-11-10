/**
 * What the person sees, for Eris's brain (ADR 0109, ADR 0124) and the app's tests (#82): the screen
 * and every window, those of the desktop in front first (front to back), then the drawer's, then the
 * other desktops' in their order, each where it is on screen (when its desktop is in front) in whole
 * CSS pixels, its place in its desktop's stacking order, how it is placed (normal, floating, snapped
 * or filled, and the part it takes), whether it is pinned, has the focus or waits in the drawer, the
 * desktop it is on and the panes it shows with the plugin that draws each, whether that plugin's
 * frame sleeps (ADR 0134) and whether it stopped answering (#39); the desktops with their pans, the
 * current one marked; the windows closed recently; and what the person can do, in short. The
 * composer sends it with every line (brain.say's `desk`), and desk.windows.list answers it to an
 * agent in the middle of a turn and to the app e2e, which reads the windows through it (#82).
 * crates/desk-wm's `Desk::snapshot` answers the same shape (`desk-view.scene.test.ts`).
 */
import type {
  BrainDesk,
  BrainDeskPane,
  BrainDeskWindow,
  BrainDeskWindowState,
} from "@endue-ai/bridge";
import { closedForBrain, int, LIMITS, PLUGIN_ID, type Size } from "../eris-context/brain";
import { mountErisContext } from "../eris-context/mount";
import { contextOf } from "../eris-context/registry";
import type { FrameResponses } from "../frames/watch";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { appSize, isFloating, screenRect } from "../surface/coordinates";
import { zOf } from "../surface/cover";
import { leaves, panesOf } from "../surface/tree";
import { resolveView } from "../surface/views";
import { desktopId, desktopsOf, layoutOf, windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import type { DeskState } from "./state";
import { surfaceTitle, type Titled } from "./titles";

/** The contract's limits (specs/bridge/v0/brain.schema.json, BrainDesk). */
const WINDOWS = 64;
const PANES = 16;
const PANE_ID = 64;
const ORIGIN = { x: 0, y: 0 };

/** A window with its place in its desktop's stacking order: 0 at the back. */
type Stacked = { p: SurfacePlacement; z: number };

/**
 * A desktop's windows front to back, as zOf stacks them, each with its rank from the back; `focused`
 * only on the one in front.
 */
function stack(s: DeskState, desktop: DesktopId, focused: string | null): Stacked[] {
  const all = windowsOf(s, desktop)
    .map((p, i) => ({ p, level: zOf(p, i, focused) }))
    .sort((a, b) => b.level - a.level);
  return all.map(({ p }, i) => ({ p, z: all.length - 1 - i }));
}

/** How a window is placed: a fill counts only on a floating window, the one it is drawn by. */
function stateOf(p: SurfacePlacement): { state: BrainDeskWindowState; fill?: typeof p.fill } {
  if (!isFloating(p)) return { state: "normal" };
  if (p.fill === "full") return { state: "filled", fill: "full" };
  if (p.fill) return { state: "snapped", fill: p.fill };
  return { state: "floating" };
}

/** What the snapshot reads: the shell's state and copy, and the runtime's frames when it has one. */
type Seen = Titled & {
  runtime?: { frames?: Pick<FrameResponses, "state"> & Partial<Pick<FrameResponses, "asleep">> };
};

/** Where a window is listed: on a desktop at its rank, or in the drawer (no desktop, no rank). */
type Seat = { pan: { x: number; y: number }; desktop?: DesktopId; z?: number };

/** The desk now: every desktop's windows, the drawer's, the desktops, the closed and what can be done. */
export function deskSnapshot(ctx: Seen, size: Size = appSize()): BrainDesk {
  const s = ctx.store.get();
  const here = desktopId(s);
  const list = desktopsOf(s);
  const panOf = (d: DesktopId) => s.pan[d] ?? ORIGIN;
  const at = (d: DesktopId, z: number): Seat => ({ pan: panOf(d), desktop: d, z });
  const front = stack(s, here, s.focused);
  const shown = front.map(({ p, z }) => windowOf(ctx, s, p, size, at(here, z)));
  const hidden = s.drawer.flatMap((d) =>
    d.placement ? [windowOf(ctx, s, d.placement, size, { pan: panOf(here) })] : [],
  );
  // A plugin window in its slot is on every desktop (ADR 0117): it is named once, where it is seen.
  const listed = new Set(front.map(({ p }) => p.id));
  const others = list
    .filter((d) => d.id !== here)
    .flatMap((d) => {
      const placed = new Set(layoutOf(s, d.id).surfaces.map((p) => p.id));
      return stack(s, d.id, null)
        .filter(({ p }) => placed.has(p.id) || !listed.has(p.id))
        .map(({ p, z }) => windowOf(ctx, s, p, size, at(d.id, z)));
    });
  const context = contextOf(ctx.store);
  return {
    screen: { w: int(size.vw, 0), h: int(size.vh, 0) },
    windows: [...shown, ...hidden, ...others].slice(0, WINDOWS),
    desktops: list.slice(0, LIMITS.desktops).map((d) => {
      const pan = panOf(d.id);
      return {
        id: d.id.slice(0, LIMITS.desktopId),
        name: (d.name || d.id).slice(0, LIMITS.name),
        ...(d.id === here ? { current: true } : {}),
        pan: { x: int(pan.x), y: int(pan.y) },
      };
    }),
    closed: context.closed ? closedForBrain(s, context.closed.list(), size) : [],
    ...(context.capabilities ? { capabilities: context.capabilities() } : {}),
  };
}

function windowOf(
  ctx: Seen,
  s: DeskState,
  p: SurfacePlacement,
  size: Size,
  where: Seat,
): BrainDeskWindow {
  const rect = screenRect(p, where.pan, size.vw, size.vh);
  const hidden = where.desktop === undefined;
  const focused = where.desktop === desktopId(s) && s.focused === p.id;
  const all = leaves(panesOf(p)).slice(0, PANES);
  const inUse = focused ? (all.find((l) => l.id === s.pane) ?? all[0])?.id : undefined;
  const panes = all.map((leaf): BrainDeskPane => {
    const view = resolveView(s, p, leaf.view);
    const id = view.startsWith("plugin:") ? view.slice("plugin:".length) : "";
    const plugin = PLUGIN_ID.test(id) ? id : undefined;
    const title = plugin
      ? (s.adopted.find((a) => a.id === plugin)?.title ?? plugin)
      : surfaceTitle(ctx, leaf.view);
    // A plugin frame that stopped answering says so, for Eris to act on (#39); one that sleeps too.
    const frames = ctx.runtime?.frames;
    const answers = plugin ? frames?.state(plugin) : undefined;
    const asleep = plugin !== undefined && answers !== "stopped" && frames?.asleep?.(plugin);
    return {
      ...(leaf.id ? { id: leaf.id.slice(0, PANE_ID) } : {}),
      view: view.slice(0, 256),
      ...(plugin ? { plugin } : {}),
      ...(title ? { title: title.slice(0, LIMITS.title) } : {}),
      ...(leaf.id === inUse ? { focused: true } : {}),
      ...(asleep ? { asleep: true } : {}),
      ...(answers === "late" || answers === "stopped" ? { responsiveness: answers } : {}),
    };
  });
  return {
    id: p.id.slice(0, LIMITS.id),
    x: int(rect.x),
    y: int(rect.y),
    w: int(rect.w, 0),
    h: int(rect.h, 0),
    ...(where.z !== undefined ? { z: where.z } : {}),
    ...stateOf(p),
    ...(isFloating(p) ? { floating: true } : {}),
    ...(p.pinned ? { pinned: true } : {}),
    ...(focused ? { focused: true } : {}),
    ...(hidden ? { hidden: true } : {}),
    ...(where.desktop ? { desktop: where.desktop.slice(0, LIMITS.desktopId) } : {}),
    panes: panes.length ? panes : [{ view: p.id.slice(0, 256) }],
  };
}

/**
 * desk.windows.list: the snapshot, for an agent that wants to look again in the middle of a turn,
 * and what Eris knows past the screen (the closed windows, the capabilities, their commands).
 */
export function defineDeskView(ctx: ShellCtx): () => void {
  const offs = [
    ctx.runtime.commands.define("desk.windows.list", {
      title: ctx.tr("cmdWindowsList"),
      keywords: ["windows", "plugins", "open", "창", "목록"],
      owner: "desk.display",
      run: () => deskSnapshot(ctx),
      agent: {
        description:
          "What the person sees on the desk now: the screen size and every window, those of the desktop in front first (the focused one first), then those put away in the drawer, then those of the other desktops with the desktop each is on; each with where it is in whole CSS pixels, its place in its desktop's stacking order (z, higher in front), how it is placed (state: normal, floating, snapped to a half or quarter, filled; fill names the part), whether it is pinned, and the panes it shows with the plugin that draws each, whether that plugin's frame sleeps (asleep) and whether it stopped answering (responsiveness: late or stopped, which desk.frames.wait, stop and reload act on). Also the desktops (the current one marked, each with its canvas pan), the windows closed recently and a summary of what the person can do. Look again after opening or moving something.",
        readOnly: true,
      },
    }),
    mountErisContext(ctx),
  ];
  return () => {
    for (const off of offs) off();
  };
}
