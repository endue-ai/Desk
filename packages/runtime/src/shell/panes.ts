/**
 * The shell's panes as the runtime's host views (ADR 0017): desk.display's focus cycling and
 * desk.buffers reach them as they reach plugin surfaces. A view's id is "<surface>/<pane>".
 */
import { leaves, panesOf } from "../surface/tree";
import { viewOf } from "../surface/views";
import type { HostViews } from "../views";
import { layoutOf } from "./actions";
import type { ShellCtx } from "./context";
import { closePane, focusPane } from "./windows";

const split = (id: string): [string, string] => {
  const at = id.lastIndexOf("/");
  return [id.slice(0, at), id.slice(at + 1)];
};

export function paneViews(ctx: ShellCtx): HostViews {
  const all = () =>
    layoutOf(ctx.store.get()).surfaces.flatMap((p) =>
      leaves(panesOf(p)).map((leaf) => ({ id: `${p.id}/${leaf.id}`, view: leaf.view })),
    );
  return {
    ids: () => all().map((view) => view.id),
    focused: () => {
      const s = ctx.store.get();
      const surface = layoutOf(s).surfaces.find((p) => p.id === s.focused);
      const pane = surface && (s.pane ?? leaves(panesOf(surface))[0]?.id);
      return surface && pane ? `${surface.id}/${pane}` : null;
    },
    focus: (id) => focusPane(ctx, ...split(id)),
    title: (id) => {
      const view = all().find((v) => v.id === id)?.view;
      return view ? viewOf(ctx, view).title : id;
    },
    close: (id) => closePane(ctx, ...split(id)),
    onChange: (listener) =>
      ctx.store.watch(
        (s) => [layoutOf(s).surfaces.map((p) => [p.id, panesOf(p)]), s.focused, s.pane, s.lang],
        listener,
      ),
  };
}
