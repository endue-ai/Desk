/**
 * The shell's panes as the runtime's host views (ADR 0017): desk.display's focus cycling and
 * desk.buffers reach them as they reach plugin surfaces. A view's id is "<surface>/<pane>".
 */
import { leaves, panesOf } from "../surface/tree";
import { resolveView, viewOf } from "../surface/views";
import type { HostViews } from "../views";
import { windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { closePane, focusPane } from "./windows";

const split = (id: string): [string, string] => {
  const at = id.lastIndexOf("/");
  return [id.slice(0, at), id.slice(at + 1)];
};

export function paneViews(ctx: ShellCtx): HostViews {
  // A pane showing a plugin's surface is that surface, which the runtime counts itself (ADR 0040).
  const all = () => {
    const s = ctx.store.get();
    return windowsOf(s).flatMap((p) =>
      leaves(panesOf(p))
        .map((leaf) => ({ id: `${p.id}/${leaf.id}`, view: resolveView(s, p, leaf.view) }))
        .filter((leaf) => !leaf.view.startsWith("plugin:")),
    );
  };
  return {
    ids: () => all().map((view) => view.id),
    focused: () => {
      const s = ctx.store.get();
      const surface = windowsOf(s).find((p) => p.id === s.focused);
      const pane = surface && (s.pane ?? leaves(panesOf(surface))[0]?.id);
      const id = surface && pane ? `${surface.id}/${pane}` : null;
      return id && all().some((v) => v.id === id) ? id : null;
    },
    focus: (id) => focusPane(ctx, ...split(id)),
    title: (id) => {
      const view = all().find((v) => v.id === id)?.view;
      return view ? viewOf(ctx, view).title : id;
    },
    close: (id) => closePane(ctx, ...split(id)),
    onChange: (listener) =>
      ctx.store.watch(
        (s) => [windowsOf(s).map((p) => [p.id, panesOf(p)]), s.adopted, s.focused, s.pane, s.lang],
        listener,
      ),
  };
}
