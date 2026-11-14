// What a tile of a plugin that is on does: bring the plugin's window forward when it has one that is
// not the window in front, else put the plugin away. Plain data in, plain data out, so it is tested
// without a DOM.

/** @typedef {import("@endue-ai/bridge").BrainDesk} Desk */

/**
 * Whether the tile of `plugin` brings its window forward rather than putting the plugin away: the
 * plugin shows in a window, and none of its windows is the one in front. The window in front is on
 * the desktop in front, not in the drawer, and in use or above every other window there; a window
 * under others, in the drawer or on another desktop comes forward. A plugin whose window was closed
 * has none, and its tile puts it away as before.
 * @param {Desk} desk what desk.windows.list answers
 * @param {string} plugin
 */
export function bringsForward(desk, plugin) {
  const windows = desk.windows ?? [];
  const mine = windows.filter((window) => window.panes.some((pane) => pane.plugin === plugin));
  if (mine.length === 0) return false;
  const current = desk.desktops?.find((desktop) => desktop.current)?.id;
  const shown = windows.filter(
    (window) =>
      !window.hidden &&
      (current === undefined || window.desktop === undefined || window.desktop === current),
  );
  // The list runs front to back; `z` says it outright where the window manager gives it.
  const top = shown.reduce(
    (front, window) => ((window.z ?? -1) > (front.z ?? -1) ? window : front),
    shown[0],
  );
  return !mine.some(
    (window) => shown.includes(window) && (window.focused === true || window === top),
  );
}
