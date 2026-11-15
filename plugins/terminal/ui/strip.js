// The tab strip over a terminal's tabs of split panes (issue 315, view.js): a strip tab (tabs.js) stands
// for every pane of its tab and acts on the pane in use there; it shows that pane's title, the unread
// count of all its panes, and the ended mark once every pane's program has ended.
import { createTabs } from "./tabs.js";

/**
 * @typedef {{ tab: string, title: string, unread: number, ended: boolean }} Item
 * @typedef {import("./view.js").Actions} Actions
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} strip
 * @param {Actions} actions
 * @param {Map<string, Item>} items the view's panes, by session
 * @param {import("@endue-ai/plugin-sdk").PluginDnd} [dnd]
 */
export function createStrip(doc, strip, actions, items, dnd) {
  /** A tab's panes, and the one in use there. */
  const paneIds = (/** @type {string} */ tab) =>
    [...items].filter(([, item]) => item.tab === tab).map(([id]) => id);
  /** @type {Map<string, string>} */
  const using = new Map();
  const inUse = (/** @type {string} */ tab) => using.get(tab) ?? paneIds(tab)[0] ?? tab;
  /** The strip's tabs act on their pane in use; its title, badge and ended mark are theirs. */
  const tabs = createTabs(
    doc,
    strip,
    {
      select: (tab) => actions.select(inUse(tab)),
      activate: (tab) => actions.activate(inUse(tab)),
      close: (tab) => {
        for (const id of paneIds(tab)) actions.close(id);
      },
      rename: (tab, title) => actions.rename(inUse(tab), title),
      move: (tab, index) => actions.move(inUse(tab), index),
      session: (tab) => actions.session?.(inUse(tab)),
    },
    dnd,
  );
  const tabState = (/** @type {string} */ tab) => {
    const own = paneIds(tab).map((id) => /** @type {Item} */ (items.get(id)));
    const used = items.get(inUse(tab));
    if (used) tabs.retitle(tab, used.title);
    tabs.badge(
      tab,
      own.reduce((sum, item) => sum + item.unread, 0),
    );
    tabs.ended(tab, own.length > 0 && own.every((item) => item.ended));
  };
  return { tabs, paneIds, inUse, using, tabState };
}
