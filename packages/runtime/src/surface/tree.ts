/**
 * Reading a window's tabs (ADR 0268), as the window manager publishes them: its tabs first to last,
 * the one it shows, and the kind of tab it takes. Adding, closing and showing a tab are the window
 * manager's (crates/desk-wm `tabs.rs`); the page only draws what it is given.
 */
import { pluginOf } from "../instances";
import type { SavedPane, SurfacePlacement, Tab } from "../modes/types";

export const LAUNCHER = "launcher";
const PLUGIN_VIEW = "plugin:";

/** The panes of a tree a layout saved while a window split inside, first to last, as tabs. */
function saved(node: SavedPane): Tab[] {
  return node.kind === "view"
    ? [{ id: node.id, view: node.view }]
    : [...saved(node.a), ...saved(node.b)];
}

/**
 * A window's tabs: as saved (a layout from before tabs kept `panes`), or one tab showing the view
 * named by its id.
 */
export function tabsOf(p: Pick<SurfacePlacement, "id" | "tabs" | "panes">): Tab[] {
  if (p.tabs?.length) return p.tabs;
  const old = p.panes ? saved(p.panes) : [];
  return old.length ? old : [{ id: "p1", view: p.id }];
}

/** The tab a window shows: the one `tab` names, else its first. */
export function shownTab(p: Pick<SurfacePlacement, "id" | "tabs" | "tab" | "panes">): Tab {
  const tabs = tabsOf(p);
  return tabs.find((t) => t.id === p.tab) ?? (tabs[0] as Tab);
}

/**
 * The plugin every tab of a window shows a window of (ADR 0212): the kind of tab it takes. None for
 * a window showing a view of the shell's own: it takes no tab. `resolve` says what a tab shows
 * (`resolveView`).
 */
export function tabKind(
  tabs: readonly Tab[],
  resolve: (view: string) => string,
): string | undefined {
  const kinds = tabs.map((t) => {
    const view = resolve(t.view);
    return view.startsWith(PLUGIN_VIEW) ? pluginOf(view.slice(PLUGIN_VIEW.length)) : undefined;
  });
  const first = kinds[0];
  return first !== undefined && kinds.every((k) => k === first) ? first : undefined;
}
