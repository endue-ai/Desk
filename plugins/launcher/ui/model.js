// What the launcher lists, and in which order. Plain data in, plain data out, so it is tested
// without a DOM.

/** Placements that open on the desk itself; edges and overlays are the desk's own chrome. */
const ON_DESK = new Set(["center", "floating"]);
/** How many plugins the Recent row holds, and how many the launcher remembers. */
export const RECENT = 6;
export const KEPT = 24;

/**
 * @typedef {{ id: string, name: string, initial: string, open: boolean, available: boolean,
 *   reason?: string }} Tile
 */

/**
 * One tile per UI plugin that opens on the desk, by name. A failed plugin keeps its tile,
 * unavailable, so people see why it is missing. The launcher itself has none.
 * @param {import("@endue-ai/bridge").PluginInfo[]} plugins
 * @param {string} [self] the launcher's own id
 * @returns {Tile[]}
 */
export function tiles(plugins, self = "endue.launcher") {
  return plugins
    .filter((plugin) => plugin.id !== self && opensOnDesk(plugin))
    .map((plugin) => {
      const name = plugin.manifest?.name || plugin.id;
      const ready = plugin.status === "ready";
      return {
        id: plugin.id,
        name,
        initial: ([...name][0] ?? "?").toUpperCase(),
        open: ready && plugin.enabled,
        available: ready,
        ...(ready ? {} : { reason: plugin.error ?? "failed" }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** @param {import("@endue-ai/bridge").PluginInfo} plugin */
function opensOnDesk(plugin) {
  const manifest = plugin.manifest;
  if (manifest?.kind !== "ui") return false;
  const placement = manifest.surfaces?.[0]?.placement;
  return placement === undefined || ON_DESK.has(placement);
}

/**
 * The tiles whose name or id holds what was typed: names that start with it first, then names
 * that hold it, then ids. Nothing typed keeps them all, in order.
 * @param {Tile[]} all
 * @param {string} typed
 */
export function matching(all, typed) {
  const q = typed.trim().toLowerCase();
  if (q === "") return all;
  const rank = (/** @type {Tile} */ t) => {
    const name = t.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return t.id.toLowerCase().includes(q) ? 2 : 3;
  };
  return all.filter((t) => rank(t) < 3).sort((a, b) => rank(a) - rank(b));
}

/**
 * The Recent row: the plugins opened from here lately that are still installed, newest first.
 * @param {Tile[]} all
 * @param {unknown} kept the ids as stored
 */
export function recent(all, kept) {
  const ids = Array.isArray(kept) ? kept.filter((id) => typeof id === "string") : [];
  return ids
    .map((id) => all.find((t) => t.id === id))
    .filter((t) => t !== undefined)
    .slice(0, RECENT);
}

/**
 * The ids to keep once `id` was opened: it first, each once, at most KEPT.
 * @param {unknown} kept
 * @param {string} id
 */
export function opened(kept, id) {
  const ids = Array.isArray(kept) ? kept.filter((k) => typeof k === "string" && k !== id) : [];
  return [id, ...ids].slice(0, KEPT);
}

/**
 * The tile the selection moves to from `from` by one step in a grid `columns` wide: left and
 * right through the tiles in order, up and down by a row, staying where there is no tile.
 * @param {number} count how many tiles
 * @param {number} from
 * @param {"left" | "right" | "up" | "down"} step
 * @param {number} columns
 */
export function moved(count, from, step, columns) {
  if (count === 0) return 0;
  const by = { left: -1, right: 1, up: -Math.max(1, columns), down: Math.max(1, columns) }[step];
  const to = from + by;
  return to < 0 || to >= count ? from : to;
}
