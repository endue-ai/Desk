/**
 * The rest of what a window's menu, the drawer and the desktops do with a window, for agents
 * (ADR 0269): float it above the canvas or put it back on it, pin it, bring it back from the
 * drawer, move it to another desktop or a new one, open a new window, and open a tab or close one (ADR 0270).
 * Each runs what the person's button, key or drag runs (`shell/actions.ts`, `shell/windows.ts`,
 * `desktops/actions.ts`); the window manager does the rest (crates/desk-wm, #83). A window popped
 * out into an OS window of its own is pinned above other OS windows, takes a new tab as a further
 * OS window of its plugin and closes its one tab as it closes (ADR 0294).
 */

import { moveToNew, moveWindowTo } from "../desktops/actions";
import { idAt } from "../desktops/model";
import { type Ctx, desktopsOf, raise, togglePin, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { closeTab, newTab, newWindow, toggleFloating } from "../shell/windows";
import { outWindows } from "../surface/placed";
import { tabsOf } from "../surface/tree";
import { closeOutTab, newOutTab } from "./out-tabs";
import {
  type Args,
  argsOf,
  FRAME,
  failed,
  frameOf,
  outFrameOf,
  runOut,
  sayOf,
  WINDOW_ARG,
  windowInFront,
  windowTarget,
} from "./target";

export const FLOAT = "desk.windows.float";
export const PIN = "desk.windows.pin";
export const BRING_BACK = "desk.windows.bring-back";
export const MOVE_TO_DESKTOP = "desk.windows.move-to-desktop";
export const NEW = "desk.windows.new";
export const NEW_TAB = "desk.windows.new-tab";
export const CLOSE_TAB = "desk.windows.close-tab";

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
          "Float a window of the current desktop above the canvas (floating: true), where it stays put on screen while the canvas pans, or put it back on the canvas, moving with it (false), as its window menu's Floating mode does. It stays where it is on screen; putting a snapped or filled one on the canvas ends its fill.",
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
        const target = windowTarget(ctx, a);
        const p = target.p;
        const pinned = on(a, "pinned");
        if (target.out) return outFrameOf(ctx, p, await runOut(ctx, p.id, { op: "pin", pinned }));
        if (pinned !== (p.pinned === true)) await togglePin(ctx, p.id);
        return frameOf(ctx, p.id);
      },
      agent: {
        description:
          "Pin a window of the current desktop (pinned: true), drawing it above the windows of its kind that are not pinned and below the one in use, or unpin it (false), as its window menu's Pin does. A window popped out into an OS window of its own stays above the other OS windows while pinned.",
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
          "Bring a window put away in the drawer (hidden in desk.windows.list) back onto the current desktop, where it was, with its tabs, as picking it in the drawer does; desk.windows.put-away puts one there.",
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
        if (outWindows(s).some((p) => p.id === given)) throw failed(say("isOut"));
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
          "Open a new window on the current desktop with one launcher tab, cascading from the middle of what is in sight, and give it the focus, as Mod+N does. To show a plugin, desk.plugins.open is the way.",
        args: { type: "object", properties: {}, additionalProperties: false },
        result: FRAME,
      },
    }),
    commands.define(NEW_TAB, {
      title: () => say("newTab"),
      keywords: ["new", "tab", "window", "새", "탭", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const target = windowTarget(ctx, a);
        if (target.out) return newOutTab(ctx, target.p);
        const p = target.p;
        const tab = await newTab(ctx, p.id);
        if (!tab) throw failed(say("noTabs"));
        return { window: p.id, tab };
      },
      agent: {
        description:
          "Open a new tab in a window of the current desktop (the one in use unless named), as its window menu's New tab and Mod+D do: another window of the plugin the window shows, which takes the focus, and its id is answered (desk.windows.list lists a window's tabs as its panes). A window takes only tabs of its own plugin (ADR 0270); a window of the launcher or an agent takes none. A window popped out into an OS window of its own has no tab strip: there the plugin's next window opens in an OS window of its own (out: true), and window and tab name it.",
        args: {
          type: "object",
          properties: { window: WINDOW_ARG },
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: {
            window: { type: "string" },
            tab: { type: "string" },
            out: { type: "boolean" },
          },
          required: ["window", "tab"],
        },
      },
    }),
    commands.define(CLOSE_TAB, {
      title: () => say("closeTab"),
      keywords: ["close", "tab", "window", "닫기", "탭"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const target = windowTarget(ctx, a);
        if (target.out) return closeOutTab(ctx, target.p, a.tab);
        const p = target.p;
        const tab = a.tab;
        if (typeof tab !== "string" || !tabsOf(p).some((t) => t.id === tab)) {
          throw failed(say("noTab"));
        }
        await closeTab(ctx, p.id, tab);
        const left = windowsOf(ctx.store.get()).find((w) => w.id === p.id);
        const closed = !left || !tabsOf(left).some((t) => t.id === tab);
        return { window: p.id, tab, closed, windowClosed: !left };
      },
      agent: {
        description:
          "Close one tab of a window of the current desktop, by its id (desk.windows.list lists a window's tabs as its panes). Closing a window's last tab closes the window, asking about unsaved changes first; the tab stays when the person keeps them (closed: false). A window popped out into an OS window of its own has one tab, so closing it closes that OS window.",
        args: {
          type: "object",
          properties: {
            window: WINDOW_ARG,
            tab: { type: "string", description: "The tab, by id (desk.windows.list panes)." },
          },
          required: ["tab"],
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: {
            window: { type: "string" },
            tab: { type: "string" },
            closed: { type: "boolean" },
            windowClosed: { type: "boolean" },
          },
          required: ["window", "tab", "closed", "windowClosed"],
        },
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
