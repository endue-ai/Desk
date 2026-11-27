/**
 * Sweep's commands (ADR 0296), for the palette, keys and Eris: desk.sweep.mode picks what Cmd+drag
 * does; desk.sweep.selection says which windows the person selected (Eris reads it when they say
 * "these"), .select and .clear change it, and .snapshot hands Eris a snapshot of the selection (or
 * of the whole desk) with the next line.
 */
import { WORKSPACE_TOOLS } from "../agent-specs";
import type { ShellCtx } from "../shell/context";
import { around, SWEEP_LABELS, SWEEP_MODES, type SweepMode } from "./model";
import { askWith, setSweep, windowsSeen } from "./Sweep";
import { takeSnapshot } from "./snapshot";

export const MODE = "desk.sweep.mode";
export const SELECTION = "desk.sweep.selection";
export const SELECT = "desk.sweep.select";
export const CLEAR = "desk.sweep.clear";
export const SNAPSHOT = "desk.sweep.snapshot";

export function defineSweepCommands(root: HTMLElement, ctx: ShellCtx): () => void {
  const { commands } = ctx.runtime;
  const selected = () => {
    const ids = new Set(ctx.store.get().sweep.selected);
    return windowsSeen(root, ctx).filter((w) => ids.has(w.id));
  };
  const offs = [
    commands.define(MODE, {
      title: () => "Sweep: choose what Cmd+drag does",
      keywords: ["sweep", "drag", "mode", "pan", "arrange", "ask", "select", "스윕"],
      owner: "desk",
      run: (args) => {
        const mode = (args as { mode?: unknown } | undefined)?.mode;
        if (typeof mode !== "string" || !(SWEEP_MODES as readonly string[]).includes(mode))
          throw new Error(`A sweep mode is one of ${SWEEP_MODES.join(", ")}.`);
        setSweep(ctx, { mode: mode as SweepMode });
        return { mode, said: `Cmd+drag now does ${SWEEP_LABELS[mode as SweepMode]}.` };
      },
      agent: {
        description:
          "Choose what the person's Cmd+drag on the empty desk does: pan (move the canvas), arrange (lay the windows it touches out in the area), ask (snapshot the area for you, Eris) or select (pick the windows it touches).",
        args: {
          type: "object",
          properties: { mode: { type: "string", enum: [...SWEEP_MODES] } },
          required: ["mode"],
          additionalProperties: false,
        },
      },
    }),
    commands.define(SELECTION, {
      title: () => "Sweep: the selected windows",
      owner: "desk",
      run: () => ({
        windows: selected().map(({ id, title, plugin }) => ({ window: id, title, plugin })),
      }),
      agent: {
        description:
          'The windows the person selected with a sweep (Cmd+drag), by id, title and plugin. When they say "these windows" or "the selected ones", these are the ones; window commands such as desk.windows.close take the id.',
        readOnly: true,
      },
    }),
    commands.define(SELECT, {
      title: () => "Sweep: select windows",
      owner: "desk",
      run: (args) => {
        const asked = (args as { windows?: unknown } | undefined)?.windows;
        const known = new Set(windowsSeen(root, ctx).map((w) => w.id));
        const ids = Array.isArray(asked) ? asked.filter((id) => known.has(String(id))) : [];
        setSweep(ctx, { selected: ids.map(String) });
        return { selected: ids };
      },
      agent: {
        description:
          "Select windows on the person's desk, as their sweep would: they see the rings and the selection bar. Ids from desk.windows.list.",
        args: {
          type: "object",
          properties: { windows: { type: "array", items: { type: "string" } } },
          required: ["windows"],
          additionalProperties: false,
        },
      },
    }),
    commands.define(CLEAR, {
      title: () => "Sweep: clear the selection",
      keywords: ["sweep", "selection", "clear", "deselect"],
      owner: "desk",
      run: () => setSweep(ctx, { selected: [] }),
      agent: { description: "Clear the person's sweep selection." },
    }),
    commands.define(SNAPSHOT, {
      title: () => "Sweep: snapshot for Eris",
      keywords: ["snapshot", "screenshot", "capture", "eris", "스냅샷"],
      owner: "desk",
      agent: WORKSPACE_TOOLS.snapshot,
      run: async (_args, { caller }) => {
        const all = windowsSeen(root, ctx);
        const picked = selected();
        const r = root.getBoundingClientRect();
        // The selection's area, else the whole desk.
        const area = around(picked.map((w) => w.box)) ?? { x: 0, y: 0, w: r.width, h: r.height };
        const background = getComputedStyle(root).backgroundColor;
        const shown = picked.length > 0 ? picked : all;
        const context = await takeSnapshot(ctx.bridge, area, shown, background);
        if (!caller?.startsWith("agent:")) await askWith(ctx, context);
        return { said: context.text, ...(context.path ? { path: context.path } : {}) };
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
