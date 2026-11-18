/**
 * The shell's own views as the runtime's host views (ADR 0017): desk.display's focus cycling and
 * desk.buffers reach them as they reach plugin surfaces. A view's id is "<surface>/<tab>", for the
 * tab each window shows (ADR 0268).
 */
import { shownTab, tabsOf } from "../surface/tree";
import { resolveView, viewOf } from "../surface/views";
import type { HostViews } from "../views";
import { windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { closeTab, focusTab } from "./windows";

const split = (id: string): [string, string] => {
  const at = id.lastIndexOf("/");
  return [id.slice(0, at), id.slice(at + 1)];
};

export function paneViews(ctx: ShellCtx): HostViews {
  // A tab showing a plugin's surface is that surface, which the runtime counts itself (ADR 0040).
  const all = () => {
    const s = ctx.store.get();
    return windowsOf(s)
      .map((p) => {
        const tab = shownTab(p);
        return { id: `${p.id}/${tab.id}`, view: resolveView(s, p, tab.view) };
      })
      .filter((shown) => !shown.view.startsWith("plugin:"));
  };
  return {
    ids: () => all().map((view) => view.id),
    focused: () => {
      const s = ctx.store.get();
      const surface = windowsOf(s).find((p) => p.id === s.focused);
      const id = surface ? `${surface.id}/${shownTab(surface).id}` : null;
      return id && all().some((v) => v.id === id) ? id : null;
    },
    // The window manager's own word for the plugin in use: a press desk-wm took, a close, a command.
    inUse: () => ctx.store.get().wm.focusedPlugin,
    focus: (id) => focusTab(ctx, ...split(id)),
    title: (id) => {
      const view = all().find((v) => v.id === id)?.view;
      return view ? viewOf(ctx, view).title : id;
    },
    close: (id) => closeTab(ctx, ...split(id)),
    onChange: (listener) =>
      ctx.store.watch(
        (s) => [
          windowsOf(s).map((p) => [p.id, tabsOf(p), p.tab]),
          s.adopted,
          s.focused,
          s.tab,
          s.wm.focusedPlugin,
          s.lang,
        ],
        listener,
      ),
  };
}
