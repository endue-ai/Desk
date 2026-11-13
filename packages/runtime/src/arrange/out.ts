/**
 * desk.windows.pop-out and desk.windows.dock (issue 235, ADR 0205): a window of the canvas leaves for an
 * OS window of its own and comes back to its place. The window manager keeps the window (its id,
 * its desktop, its canvas place) while it is out; the compositor's shell opens and closes the OS
 * window as the desk it publishes says. Only a window that shows one plugin's surface pops out:
 * the runtime's own views are drawn in its page (issue 239). The move loads the plugin's page again, so
 * the plugin is asked for its state first and gets it back in its next init, as after a sleep (ADR
 * 0205). A host with no compositor ignores both.
 */
import { CommandError } from "../commands";
import { type Ctx, windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { outWindows, windowPlugins } from "../surface/placed";
import { leaves, panesOf } from "../surface/tree";
import { type ArrangeCopyKey, arrangeText } from "./copy";

export const POP_OUT = "desk.windows.pop-out";
export const DOCK = "desk.windows.dock";

const WINDOW = {
  type: "object",
  properties: { window: { type: "string", description: "The window, by id." } },
  additionalProperties: false,
};

/** Whether window `id` of the desktop in front shows one plugin's surface and nothing else. */
export function poppable(s: DeskState, id: string): boolean {
  const p = windowsOf(s).find((w) => w.id === id);
  return !!p && leaves(panesOf(p)).length === 1 && windowPlugins(s, id).length === 1;
}

/** The windows out of the canvas, by id, as the window manager published them. */
export function outIds(s: DeskState): Set<string> {
  return new Set(outWindows(s).map((p) => p.id));
}

export function defineOutCommands(ctx: Ctx): () => void {
  const { commands } = ctx.runtime;
  const say = (key: ArrangeCopyKey) => arrangeText(ctx.store.get().lang, key);
  const named = (args: unknown) => (args as { window?: unknown } | undefined)?.window;
  // The move loads the plugin's page again: it keeps its state as an unload does (ADR 0205).
  const keep = async (window: string) => {
    const [plugin] = windowPlugins(ctx.store.get(), window);
    if (plugin) await ctx.runtime.plugins?.keep?.(plugin);
  };
  const offs = [
    commands.define(POP_OUT, {
      title: say("popOut"),
      keywords: ["pop out", "detach", "window", "os", "꺼내기", "창", "분리"],
      owner: "desk",
      run: async (args) => {
        const given = named(args);
        const s = ctx.store.get();
        const window = typeof given === "string" ? given : s.focused;
        if (!window) throw new CommandError("failed", "say which: { window }");
        if (!windowsOf(s).some((p) => p.id === window))
          throw new CommandError("failed", say("notHere"));
        if (!poppable(s, window)) throw new CommandError("failed", say("notOne"));
        await keep(window);
        ctx.wm.run({ op: "pop-out" }, window);
        return { window };
      },
      agent: {
        description:
          "Move a window of the current desktop off the canvas into an OS window of its own, the window in use when none is named. Only a window that shows one plugin pops out; desk.windows.dock brings it back.",
        args: WINDOW,
      },
    }),
    commands.define(DOCK, {
      title: say("dock"),
      keywords: ["dock", "back", "window", "desk", "되돌리기", "창", "데스크"],
      owner: "desk",
      run: async (args) => {
        const window = named(args);
        if (typeof window !== "string") throw new CommandError("failed", "say which: { window }");
        if (!outIds(ctx.store.get()).has(window)) throw new CommandError("failed", say("notOut"));
        await keep(window);
        ctx.wm.run({ op: "dock" }, window);
        return { window };
      },
      agent: {
        description:
          "Bring a window that was popped out into an OS window back to its place on its desktop's canvas; that desktop comes to the front with it in use.",
        args: { ...WINDOW, required: ["window"] },
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
