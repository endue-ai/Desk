/**
 * desk.windows.put-away (issue 280): a window of the desktop in front goes into the drawer under
 * the title its title bar shows, the window in use when none is named. The drawer at the bottom
 * edge lists it and brings it back (`shell/Drawer.ts`). A window's title bar has no tool for it:
 * the palette, a key the person binds and an agent run this command.
 */
import { CommandError } from "../commands";
import { stash, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { activeView, viewOf } from "../surface/views";
import { type ArrangeCopyKey, arrangeText } from "./copy";

export const PUT_AWAY = "desk.windows.put-away";

export function defineAwayCommand(ctx: ShellCtx): () => void {
  const say = (key: ArrangeCopyKey) => arrangeText(ctx.store.get().lang, key);
  return ctx.runtime.commands.define(PUT_AWAY, {
    title: say("putAway"),
    keywords: ["put away", "drawer", "stash", "hide", "window", "서랍", "넣기", "치우기", "창"],
    owner: "desk",
    run: async (args) => {
      const given = (args as { window?: unknown } | undefined)?.window;
      const s = ctx.store.get();
      const window = typeof given === "string" ? given : s.focused;
      if (!window) throw new CommandError("failed", "say which: { window }");
      const placement = windowsOf(s).find((p) => p.id === window);
      if (!placement) throw new CommandError("failed", say("notHere"));
      const name = viewOf(ctx, activeView(ctx, placement)).title;
      await stash(ctx, window, name);
      return { window, name };
    },
    agent: {
      description:
        "Put a window of the current desktop away in the drawer under its title, the window in use when none is named: it leaves the desktop and keeps its place and panes, and the drawer brings it back. Not a close: the plugins it shows are kept.",
      args: {
        type: "object",
        properties: { window: { type: "string", description: "The window, by id." } },
        additionalProperties: false,
      },
    },
  });
}
