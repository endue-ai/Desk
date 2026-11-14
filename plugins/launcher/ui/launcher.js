// The launcher's behaviour: the list from plugin.list, the Recent row from its own store, what is
// typed, the selection, and opening a plugin with desk.plugins.open. view.js holds the DOM,
// main.js the SDK.
import { matching, moved, opened, recent, tiles } from "./model.js";

const KEY = "recent";

/**
 * @typedef {import("./model.js").Tile} Tile
 * @typedef {{
 *   call(method: string, params: object): Promise<any>,
 *   run(command: string, args: object): Promise<unknown>,
 *   show(): void,
 *   hide(): void,
 * }} Desk
 * @typedef {{
 *   draw(state: { recent: Tile[], all: Tile[], selected: string | undefined, typed: string }): void,
 *   status(text: string): void,
 *   focus(): void,
 *   columns(): number,
 * }} View
 */

/**
 * @param {Desk} desk
 * @param {View} view
 */
export function createLauncher(desk, view) {
  /** @type {Tile[]} */
  let all = [];
  /** @type {unknown} */
  let kept = [];
  let typed = "";
  /** @type {string | undefined} */
  let selected;
  let shown = false;

  /** The tiles in the order the arrows walk them: the Recent row, then the rest. */
  const walk = () => {
    const found = matching(all, typed);
    const first = typed.trim() === "" ? recent(all, kept) : [];
    return { first, found, order: [...first, ...found] };
  };

  function draw() {
    const { first, found, order } = walk();
    if (!order.some((t) => t.id === selected)) selected = order[0]?.id;
    view.draw({ recent: first, all: found, selected, typed });
  }

  async function open() {
    typed = "";
    selected = undefined;
    const [listed, stored] = await Promise.all([
      desk.call("plugin.list", { scope: { permission: "plugin:manage" } }).catch(() => undefined),
      desk.call("store.get", { key: KEY }).catch(() => undefined),
    ]);
    all = tiles(listed?.plugins ?? []);
    kept = stored?.value;
    view.status(listed ? "" : "The plugins could not be listed.");
    draw();
    shown = true;
    desk.show();
    view.focus();
  }

  function close() {
    shown = false;
    desk.hide();
  }

  return {
    /** Show the grid, or put it away when it shows. */
    toggle: () => (shown ? close() : open()),
    close,
    /** What the person typed into the field. */
    type(text) {
      typed = text;
      selected = undefined;
      draw();
    },
    /** An arrow key. */
    move(step) {
      const { order } = walk();
      const at = Math.max(
        0,
        order.findIndex((t) => t.id === selected),
      );
      selected = order[moved(order.length, at, step, view.columns())]?.id;
      draw();
    },
    /** Open plugin `id`, the selected one when none is named, and put the grid away. */
    async launch(id = selected) {
      const tile = all.find((t) => t.id === id);
      if (!tile) return;
      if (!tile.available) {
        view.status(`${tile.name} cannot open: ${tile.reason ?? "it failed to load"}.`);
        return;
      }
      close();
      kept = opened(kept, tile.id);
      void desk.call("store.set", { key: KEY, value: kept }).catch(() => {});
      await desk.run("desk.plugins.open", { plugin: tile.id }).catch(() => {});
    },
    /** Whether the grid shows. */
    shown: () => shown,
  };
}
