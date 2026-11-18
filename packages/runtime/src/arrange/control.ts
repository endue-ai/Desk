/**
 * The rest of what a window's title bar, the drawer and the desktops do with a window, for agents
 * (ADR 0269): float it above the canvas or put it back on it, pin it, bring it back from the
 * drawer, move it to another desktop or a new one, open a new window, split a pane and close one.
 * Each runs what the person's button, key or drag runs (`shell/actions.ts`, `shell/windows.ts`,
 * `desktops/actions.ts`); the window manager does the rest (crates/desk-wm, #83).
 */

import { moveToNew, moveWindowTo } from "../desktops/actions";
import { idAt } from "../desktops/model";
import { type Ctx, desktopsOf, raise, togglePin, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { closePane, focusPane, newWindow, splitPane, toggleFloating } from "../shell/windows";
import { leaves, panesOf } from "../surface/tree";
import {
  type Args,
  argsOf,
  FRAME,
  failed,
  frameOf,
  sayOf,
  WINDOW_ARG,
  windowInFront,
} from "./target";

export const FLOAT = "desk.windows.float";
export const PIN = "desk.windows.pin";
export const BRING_BACK = "desk.windows.bring-back";
export const MOVE_TO_DESKTOP = "desk.windows.move-to-desktop";
export const NEW = "desk.windows.new";
export const SPLIT = "desk.windows.split";
export const CLOSE_PANE = "desk.windows.close-pane";

const flag = (name: string, description: string) => ({
  type: "object",
  properties: { window: WINDOW_ARG, [name]: { type: "boolean", description } },
  required: [name],
  additionalProperties: false,
});

const NAMED = (description: string) => ({ ...WINDOW_ARG, description });

/** A boolean arg, refused when it is something else. */
function on(args: Args, name: string): boolean {
  const value = args[name];
  if (typeof value !== "boolean") throw failed(`${name} is true or false`);
  return value;
}

/** The desktop `ref` names: its id, its name or its position from 1. */
function desktopNamed(ctx: Pick<Ctx, "store">, ref: unknown): string | undefined {
  const list = desktopsOf(ctx.store.get());
  if (typeof ref === "number") return idAt(list, ref);
  if (typeof ref !== "string") return undefined;
  const name = ref.trim().toLowerCase();
  return idAt(list, ref) ?? list.find((d) => d.name.trim().toLowerCase() === name)?.id;
}

export function defineControlCommands(ctx: ShellCtx): () => void {
  const { commands } = ctx.runtime;
  const say = sayOf(ctx);
  const offs = [
    commands.define(FLOAT, {
      title: () => say("float"),
      keywords: ["float", "floating", "above", "canvas", "window", "띄우기", "플로팅", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        const want = on(a, "floating");
        // The Floating button switches the mode and ends a fill: a fill saved before fills floated
        // (ADR 0128) comes out of it floating, and a second press puts it on the canvas.
        for (let press = 0; press < 2 && frameOf(ctx, p.id).floating !== want; press++) {
          await toggleFloating(ctx, p.id);
        }
        return frameOf(ctx, p.id);
      },
      agent: {
        description:
          "Float a window of the current desktop above the canvas (floating: true), where it stays put on screen while the canvas pans, or put it back on the canvas, moving with it (false), as its title bar's Floating button does. It stays where it is on screen; putting a snapped or filled one on the canvas ends its fill.",
        args: flag("floating", "Float above the canvas (true) or sit on it (false)."),
        result: FRAME,
      },
    }),
    commands.define(PIN, {
      title: () => say("pin"),
      keywords: ["pin", "unpin", "keep on top", "window", "고정", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        if (on(a, "pinned") !== (p.pinned === true)) await togglePin(ctx, p.id);
        return frameOf(ctx, p.id);
      },
      agent: {
        description:
          "Pin a window of the current desktop (pinned: true), drawing it above the windows of its kind that are not pinned and below the one in use, or unpin it (false), as its title bar's pin does.",
        args: flag("pinned", "Pin (true) or unpin (false)."),
        result: FRAME,
      },
    }),
    commands.define(BRING_BACK, {
      title: () => say("bringBack"),
      keywords: ["bring back", "drawer", "unhide", "restore", "window", "서랍", "꺼내기", "창"],
      owner: "desk",
      run: async (args) => {
        const given = argsOf(args).window;
        const item = ctx.store
          .get()
          .drawer.find(
            (d) =>
              d.kind === "surface" &&
              (d.placement?.id === given || d.id === given || d.id === `surface-${given}`),
          );
        if (typeof given !== "string" || !item?.placement) throw failed(say("notAway"));
        await raise(ctx, item.id);
        return frameOf(ctx, item.placement.id);
      },
      agent: {
        description:
          "Bring a window put away in the drawer (hidden in desk.windows.list) back onto the current desktop, where it was, with its panes, as picking it in the drawer does; desk.windows.put-away puts one there.",
        args: {
          type: "object",
          properties: { window: NAMED("The window in the drawer, by id.") },
          required: ["window"],
          additionalProperties: false,
        },
        result: FRAME,
      },
    }),
    commands.define(MOVE_TO_DESKTOP, {
      title: () => say("moveToDesktop"),
      keywords: ["move", "desktop", "send", "window", "데스크톱", "옮기기", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const s = ctx.store.get();
        const given = typeof a.window === "string" ? a.window : s.focused;
        const holds = desktopsOf(s).some((d) => windowsOf(s, d.id).some((p) => p.id === given));
        if (!given || !holds) throw failed(say(given ? "notHere" : "noWindow"));
        if (a.desktop === "new") {
          const moved = await moveToNew(ctx, given);
          return { window: given, moved, desktop: moved ? frameOf(ctx, given).desktop : null };
        }
        const to = desktopNamed(ctx, a.desktop);
        if (to === undefined) throw failed(say("noDesktop", { desktop: String(a.desktop) }));
        const moved = await moveWindowTo(ctx, given, to);
        return { window: given, moved, desktop: to };
      },
      agent: {
        description:
          'Move a window (on any desktop; the one in use when left out) to another desktop, named by its id, its name or its position from 1, or to a new desktop at the end ("new"). The desktop in front stays in front; moved is false when the window was there already or no new desktop fits.',
        args: {
          type: "object",
          properties: {
            window: WINDOW_ARG,
            desktop: {
              type: ["string", "integer"],
              description:
                'The desktop: its id or name (desk.windows.list), its position from 1, or "new".',
            },
          },
          required: ["desktop"],
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: {
            window: { type: "string" },
            moved: { type: "boolean" },
            desktop: { type: ["string", "null"] },
          },
          required: ["window", "moved", "desktop"],
        },
      },
    }),
    commands.define(NEW, {
      title: () => say("newWindow"),
      keywords: ["new", "window", "launcher", "새", "창"],
      owner: "desk",
      run: async () => {
        const id = await newWindow(ctx);
        if (!id) throw failed(say("notHere"));
        return frameOf(ctx, id);
      },
      agent: {
        description:
          "Open a new window on the current desktop with one launcher pane, cascading from the middle of what is in sight, and give it the focus, as Mod+N does. To show a plugin, desk.plugins.open is the way.",
        args: { type: "object", properties: {}, additionalProperties: false },
        result: FRAME,
      },
    }),
    commands.define(SPLIT, {
      title: () => say("split"),
      keywords: ["split", "pane", "right", "down", "window", "나누기", "칸", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        const dir = a.dir === "right" ? "row" : a.dir === "down" ? "column" : undefined;
        if (!dir) throw failed("dir is right or down");
        const pane = typeof a.pane === "string" ? a.pane : undefined;
        if (pane && !leaves(panesOf(p)).some((l) => l.id === pane)) throw failed(say("noPane"));
        await focusPane(ctx, p.id, pane);
        await splitPane(ctx, dir);
        return { window: p.id, pane: ctx.store.get().pane };
      },
      agent: {
        description:
          "Split a pane of a window of the current desktop (the window's focused or first pane unless named) to the right or down, as its title bar's split buttons do: the new pane opens the launcher and takes the focus, and its id is answered.",
        args: {
          type: "object",
          properties: {
            window: WINDOW_ARG,
            pane: { type: "string", description: "The pane, by id (desk.windows.list panes)." },
            dir: { type: "string", enum: ["right", "down"] },
          },
          required: ["dir"],
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: { window: { type: "string" }, pane: { type: ["string", "null"] } },
          required: ["window", "pane"],
        },
      },
    }),
    commands.define(CLOSE_PANE, {
      title: () => say("closePane"),
      keywords: ["close", "pane", "window", "닫기", "칸"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        const pane = a.pane;
        if (typeof pane !== "string" || !leaves(panesOf(p)).some((l) => l.id === pane)) {
          throw failed(say("noPane"));
        }
        await closePane(ctx, p.id, pane);
        const left = windowsOf(ctx.store.get()).find((w) => w.id === p.id);
        const closed = !left || !leaves(panesOf(left)).some((l) => l.id === pane);
        return { window: p.id, pane, closed, windowClosed: !left };
      },
      agent: {
        description:
          "Close one pane of a window of the current desktop, by its id (desk.windows.list panes). Closing a window's last pane closes the window, asking about unsaved changes first; the pane stays when the person keeps them (closed: false).",
        args: {
          type: "object",
          properties: {
            window: WINDOW_ARG,
            pane: { type: "string", description: "The pane, by id." },
          },
          required: ["pane"],
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: {
            window: { type: "string" },
            pane: { type: "string" },
            closed: { type: "boolean" },
            windowClosed: { type: "boolean" },
          },
          required: ["window", "pane", "closed", "windowClosed"],
        },
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
