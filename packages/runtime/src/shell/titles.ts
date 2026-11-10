/**
 * What a surface is called where people read it: the drawer, the title bar, the launcher. One
 * place for the sample views, the launcher windows, the agent screens and the drawer's own items.
 */
import { leaves, panesOf } from "../surface/tree";
import { LOCAL_VIEW, localName } from "../system/local-ids";
import { type CopyKey, t } from "./copy";
import type { Store } from "./state";

export interface Titled {
  store: Store;
  /** The shell's copy; without it (the plain actions' tests) ids stand for themselves. */
  tr?(key: CopyKey, vars?: Record<string, string | number>): string;
}

/** The title of the surface `id` holds by default: what the drawer shows when it is put away. */
export function surfaceTitle(ctx: Titled, id: string): string {
  const tr = ctx.tr;
  if (!tr) return id;
  const s = ctx.store.get();
  if (id === "calendar") return tr("surfaceCalendar");
  if (id === "tomorrow") return tr("surfaceTomorrow");
  if (id === "notes") return tr("surfaceNotes");
  if (id === "keys") return tr("keysTitle");
  if (id === "launcher" || /^window-\d+$/.test(id)) return tr("launcherTitle");
  if (id.startsWith(LOCAL_VIEW)) {
    return tr("agentScreen", { name: localName(s.localAgents, id.slice(LOCAL_VIEW.length)) });
  }
  if (id.startsWith("agent:")) {
    const agentId = id.slice("agent:".length);
    const name = s.agents.find((a) => a.id === agentId)?.name ?? agentId;
    return tr("agentScreen", { name });
  }
  const name = id.replace(/^(file|recent):/, "");
  return s.drawer.find((d) => d.id === name)?.name ?? name.replace(/^recent-/, "");
}

/**
 * The titles of the shell's own views the windows of the desktop in front show, by view, in the
 * desk's language (`tr`: the shell's copy): what the window manager's chrome and
 * `desk.windows.list` name them.
 */
export function viewTitles(
  store: Store,
  tr: NonNullable<Titled["tr"]> = (key, vars) => t(store.get().lang, key, vars),
): Record<string, string> {
  const ctx: Titled = { store, tr };
  const titles: Record<string, string> = {};
  const { wm } = store.get();
  for (const p of wm.windows[wm.here] ?? []) {
    for (const leaf of leaves(panesOf(p))) {
      if (!leaf.view.startsWith("plugin:")) titles[leaf.view] = surfaceTitle(ctx, leaf.view);
    }
  }
  return titles;
}
