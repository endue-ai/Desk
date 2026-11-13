/**
 * What the person sees, for Eris's brain (ADR 0109, ADR 0124) and the app's tests (#82): the screen
 * and every window, those of the desktop in front first (front to back), then those out of the canvas
 * in OS windows of their own (issue 235), then the drawer's, then the other desktops' in their order, each where it is on screen (when its desktop is in front) in whole
 * CSS pixels, its place in its desktop's stacking order, how it is placed, whether it is pinned, has
 * the focus or waits in the drawer, the desktop it is on and the panes it shows with the plugin that
 * draws each, whether that plugin's frame sleeps (ADR 0134) and whether it stopped answering (#39);
 * the desktops with their pans, the current one marked; the windows closed recently; and what the
 * person can do, in short. The window manager answers the windows and desktops (crates/desk-wm
 * `Desk::snapshot_seen`, #83) with the titles of the shell's own views and the frames' states the
 * runtime tells it; the closed windows and the capabilities are the runtime's. The composer sends it
 * with every line (brain.say's `desk`), and desk.windows.list answers it to an agent in the middle
 * of a turn and to the app e2e, which reads the windows through it (#82).
 */
import type { BrainDesk } from "@endue-ai/bridge";
import { closedForBrain } from "../eris-context/brain";
import { mountErisContext } from "../eris-context/mount";
import { contextOf } from "../eris-context/registry";
import type { FrameResponses } from "../frames/watch";
import { leaves, panesOf } from "../surface/tree";
import type { WindowManagerHost } from "../wm/host";
import type { Told } from "../wm/types";
import type { ShellCtx } from "./context";
import { surfaceTitle, type Titled } from "./titles";

/** What the snapshot reads: the shell's state and copy, and the runtime's frames when it has one. */
type Seen = Titled & {
  wm: Pick<WindowManagerHost, "snapshot">;
  runtime?: { frames?: Pick<FrameResponses, "state"> & Partial<Pick<FrameResponses, "asleep">> };
};

/** The titles of every pane of the shell's own on the desk, and how each plugin's frame is doing. */
export function toldOf(ctx: Seen): Told {
  const s = ctx.store.get();
  const titles: Told["titles"] = {};
  const windows = [
    ...Object.values(s.wm.windows).flat(),
    ...s.drawer.flatMap((d) => (d.placement ? [d.placement] : [])),
  ];
  for (const p of windows) {
    for (const leaf of leaves(panesOf(p))) {
      if (!leaf.view.startsWith("plugin:") && !(leaf.view in titles))
        titles[leaf.view] = surfaceTitle(ctx, leaf.view);
    }
  }
  const frames: Told["frames"] = {};
  const runtime = ctx.runtime?.frames;
  for (const { id } of s.adopted) {
    const answers = runtime?.state(id);
    if (answers === "stopped" || answers === "late") frames[id] = answers;
    else if (runtime?.asleep?.(id)) frames[id] = "asleep";
  }
  return { titles, frames };
}

/** The desk now: every desktop's windows, the drawer's, the desktops, the closed and what can be done. */
export async function deskSnapshot(ctx: Seen): Promise<BrainDesk> {
  const desk = await ctx.wm.snapshot(toldOf(ctx));
  const context = contextOf(ctx.store);
  const closed = context.closed ? closedForBrain(ctx.store.get(), context.closed.list()) : [];
  return {
    ...desk,
    closed,
    ...(context.capabilities ? { capabilities: context.capabilities() } : {}),
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
          "What the person sees on the desk now: the screen size and every window, those of the desktop in front first (the focused one first), then those popped out of the canvas into OS windows of their own (out: the OS window's frame in points; x, y, w, h where it docks back; desk.windows.dock brings one back), then those put away in the drawer, then those of the other desktops with the desktop each is on; each with where it is in whole CSS pixels, its place in its desktop's stacking order (z, higher in front), how it is placed (state: normal, floating, snapped to a half or quarter, filled; fill names the part), whether it is pinned, and the panes it shows with the plugin that draws each, whether that plugin's frame sleeps (asleep) and whether it stopped answering (responsiveness: late or stopped, which desk.frames.wait, stop and reload act on). Also the desktops (the current one marked, each with its canvas pan), the windows closed recently and a summary of what the person can do. Look again after opening or moving something.",
        readOnly: true,
      },
    }),
    mountErisContext(ctx),
  ];
  return () => {
    for (const off of offs) off();
  };
}
