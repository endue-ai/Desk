/**
 * What the person sees, for Eris's brain (ADR 0109, ADR 0124): the screen and every window, those
 * of the desktop in front first (front to back), then the drawer's, then the other desktops' in
 * their order, each where it is on screen (when its desktop is in front), whether it floats, has
 * the focus or waits in the drawer, the desktop it is on and the panes it shows with the plugin that
 * draws each; the desktops, the current one marked; the windows closed recently; and what the person
 * can do, in short. The composer sends it with every line (brain.say's `desk`), and
 * desk.windows.list answers it to an agent in the middle of a turn.
 */
import type { BrainDesk, BrainDeskPane, BrainDeskWindow } from "@endue-ai/bridge";
import { closedForBrain, int, LIMITS, PLUGIN_ID, type Size } from "../eris-context/brain";
import { mountErisContext } from "../eris-context/mount";
import { contextOf } from "../eris-context/registry";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { appSize, screenRect } from "../surface/coordinates";
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
const ORIGIN = { x: 0, y: 0 };

/** A desktop's windows front to back, as zOf stacks them; `focused` only on the one in front. */
function stack(s: DeskState, desktop: DesktopId, focused: string | null): SurfacePlacement[] {
  return windowsOf(s, desktop)
    .map((p, i) => ({ p, z: zOf(p, i, focused) }))
    .sort((a, b) => b.z - a.z)
    .map(({ p }) => p);
}

/** The desk now: every desktop's windows, the drawer's, the desktops, the closed and what can be done. */
export function deskSnapshot(ctx: Titled, size: Size = appSize()): BrainDesk {
  const s = ctx.store.get();
  const here = desktopId(s);
  const list = desktopsOf(s);
  const at = (d: DesktopId) => ({ pan: s.pan[d] ?? ORIGIN, desktop: d });
  const front = stack(s, here, s.focused);
  const shown = front.map((p) => windowOf(ctx, s, p, size, at(here)));
  const hidden = s.drawer.flatMap((d) =>
    d.placement ? [windowOf(ctx, s, d.placement, size, { pan: s.pan[here] ?? ORIGIN })] : [],
  );
  // A plugin window in its slot is on every desktop (ADR 0117): it is named once, where it is seen.
  const listed = new Set(front.map((p) => p.id));
  const others = list
    .filter((d) => d.id !== here)
    .flatMap((d) => {
      const placed = new Set(layoutOf(s, d.id).surfaces.map((p) => p.id));
      return stack(s, d.id, null)
        .filter((p) => placed.has(p.id) || !listed.has(p.id))
        .map((p) => windowOf(ctx, s, p, size, at(d.id)));
    });
  const context = contextOf(ctx.store);
  return {
    screen: { w: int(size.vw, 0), h: int(size.vh, 0) },
    windows: [...shown, ...hidden, ...others].slice(0, WINDOWS),
    desktops: list.slice(0, LIMITS.desktops).map((d) => ({
      id: d.id.slice(0, LIMITS.desktopId),
      name: (d.name || d.id).slice(0, LIMITS.name),
      ...(d.id === here ? { current: true } : {}),
    })),
    closed: context.closed ? closedForBrain(s, context.closed.list(), size) : [],
    ...(context.capabilities ? { capabilities: context.capabilities() } : {}),
  };
}

function windowOf(
  ctx: Titled,
  s: DeskState,
  p: SurfacePlacement,
  size: Size,
  where: { pan: { x: number; y: number }; desktop?: DesktopId },
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
    return {
      view: view.slice(0, 256),
      ...(plugin ? { plugin } : {}),
      ...(title ? { title: title.slice(0, LIMITS.title) } : {}),
      ...(leaf.id === inUse ? { focused: true } : {}),
    };
  });
  return {
    id: p.id.slice(0, LIMITS.id),
    x: int(rect.x),
    y: int(rect.y),
    w: int(rect.w, 0),
    h: int(rect.h, 0),
    ...(p.floating ? { floating: true } : {}),
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
          "What the person sees on the desk now: the screen size and every window, those of the desktop in front first (the focused one first), then those put away in the drawer, then those of the other desktops with the desktop each is on; each with where it is in CSS pixels, whether it floats, and the panes it shows with the plugin that draws each. Also the desktops (the current one marked), the windows closed recently and a summary of what the person can do. Look again after opening or moving something.",
        readOnly: true,
      },
    }),
    mountErisContext(ctx),
  ];
  return () => {
    for (const off of offs) off();
  };
}
