/**
 * What a surface is called where people read it: the drawer, the title bar, the launcher. One
 * place for the sample views, the launcher windows, the agent screens and the drawer's own items.
 */
import type { CopyKey } from "./copy";
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
  if (id.startsWith("agent:")) {
    const agentId = id.slice("agent:".length);
    const name = s.agents.find((a) => a.id === agentId)?.name ?? agentId;
    return tr("agentScreen", { name });
  }
  const name = id.replace(/^(file|recent):/, "");
  return s.drawer.find((d) => d.id === name)?.name ?? name.replace(/^recent-/, "");
}
