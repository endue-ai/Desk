// The terminal's tabs as layouts of panes (issue 315), without a DOM: which tab each session (a pane) is
// in, each tab's split layout and its pane in use, and the tabs' order. A tab is named by the session
// it opened with, and keeps that name after the session goes (session ids are never used again), so
// the tab strip and the reload snapshot keep their ids. sessions.js drives it; layout.js has the tree.
import { leaf, mapPanes, neighbour, panesOf, remove, setRatio, split } from "./layout.js";

/**
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {import("./layout.js").Split} Split
 * @typedef {import("./layout.js").Direction} Direction
 * @typedef {import("./layout.js").Min} Min
 * @typedef {{ id: string, layout: Layout, focused: string }} Tab
 */

export function createTabSet() {
  /** In order. @type {Map<string, Tab>} */
  const tabs = new Map();
  /** Session -> its tab. @type {Map<string, string>} */
  const byPane = new Map();

  const tabOf = (/** @type {string} */ id) => {
    const tab = byPane.get(id);
    return tab === undefined ? undefined : tabs.get(tab);
  };
  const index = (/** @type {Tab} */ tab) => {
    for (const id of panesOf(tab.layout)) byPane.set(id, tab.id);
  };

  return {
    /** A new tab, last, of the one pane `id`. */
    add(/** @type {string} */ id) {
      /** @type {Tab} */
      const tab = { id, layout: leaf(id), focused: id };
      tabs.set(id, tab);
      byPane.set(id, id);
      return tab;
    },
    /** `added` beside `id`, in its tab, and in use there; undefined when `id` is in no tab. */
    split(/** @type {string} */ id, /** @type {Split} */ direction, /** @type {string} */ added) {
      const tab = tabOf(id);
      if (!tab) return undefined;
      tab.layout = split(tab.layout, id, direction, added);
      tab.focused = added;
      byPane.set(added, tab.id);
      return tab;
    },
    /**
     * `id` gone from its tab. The tab, with its layout and the pane in use now (its neighbour on
     * screen, or the last left), or `closed` when it was the tab's last pane.
     */
    remove(/** @type {string} */ id) {
      const tab = tabOf(id);
      byPane.delete(id);
      if (!tab) return undefined;
      const layout = remove(tab.layout, id);
      if (layout === null) {
        tabs.delete(tab.id);
        return { tab, closed: true };
      }
      if (tab.focused === id) {
        const before = panesOf(tab.layout);
        const after = panesOf(layout);
        tab.focused = after[Math.max(0, before.indexOf(id) - 1)] ?? after[0] ?? id;
      }
      tab.layout = layout;
      return { tab, closed: false };
    },
    tabOf,
    /** Make `id` its tab's pane in use. */
    focus(/** @type {string} */ id) {
      const tab = tabOf(id);
      if (tab) tab.focused = id;
      return tab;
    },
    /** The pane beside `id` in its tab, `id` at an edge. */
    neighbour(/** @type {string} */ id, /** @type {Direction} */ direction) {
      const tab = tabOf(id);
      return tab ? neighbour(tab.layout, id, direction) : id;
    },
    /** A divider of `tab` dragged: its split's ratio, within `min`. */
    ratio(
      /** @type {string} */ tab,
      /** @type {string} */ path,
      /** @type {number} */ ratio,
      /** @type {Min} */ min,
    ) {
      const t = tabs.get(tab);
      if (!t) return undefined;
      t.layout = setRatio(t.layout, path, ratio, min);
      return t;
    },
    /** Move `tab` to `to` among the tabs: the index it took, or -1 when it did not move. */
    move(/** @type {string} */ tab, /** @type {number} */ to) {
      const ids = [...tabs.keys()];
      const from = ids.indexOf(tab);
      const at = Math.max(0, Math.min(ids.length - 1, Math.trunc(to)));
      if (from < 0 || from === at) return -1;
      ids.splice(from, 1);
      ids.splice(at, 0, tab);
      const all = ids.map((id) => /** @type {Tab} */ (tabs.get(id)));
      tabs.clear();
      for (const t of all) tabs.set(t.id, t);
      return at;
    },
    /** A tab made again (a reload, a restart), last, its panes renamed by `rename`. */
    restore(
      /** @type {string} */ id,
      /** @type {Layout} */ layout,
      /** @type {string} */ focused,
      /** @type {(pane: string) => string} */ rename = (pane) => pane,
    ) {
      const live = mapPanes(layout, rename);
      const panes = panesOf(live);
      /** @type {Tab} */
      const tab = {
        id,
        layout: live,
        focused: panes.includes(focused) ? focused : (panes[0] ?? id),
      };
      tabs.set(id, tab);
      index(tab);
      return tab;
    },
    /** The tabs in order. */
    all: () => [...tabs.values()],
    /** The sessions in order: tab by tab, each tab's panes a before b. */
    panes: () => [...tabs.values()].flatMap((tab) => panesOf(tab.layout)),
  };
}
