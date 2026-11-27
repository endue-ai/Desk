/**
 * The icons the compositor draws in the canvas map's windows (ADR 0273): each view's, as its title
 * bar shows it (`plugin-icons.ts`), in SVG path data it strokes the way `icons.ts` does.
 */
import { tabsOf } from "../surface/tree";
import { resolveView } from "../surface/views";
import { iconPath } from "./icons";
import { viewIcon } from "./plugin-icons";
import type { Store } from "./state";

/**
 * The icon of every view the windows of the desktop in front show, by view as the window manager
 * resolves it (`plugin:<id>` for a plugin's surface), as SVG path data on the 24 grid.
 */
export function viewIcons(store: Store): Record<string, string> {
  const s = store.get();
  const icons: Record<string, string> = {};
  for (const p of s.wm.windows[s.wm.here] ?? []) {
    for (const tab of tabsOf(p)) {
      const view = resolveView(s, p, tab.view);
      icons[view] = iconPath(viewIcon(view));
    }
  }
  return icons;
}
