// Which plugins the dock shows, and how. Plain data in, plain data out, so it is tested without a DOM.

/** Placements that open on the desk itself; edges and overlays are the desk's own chrome. */
const ON_DESK = new Set(["center", "floating"]);

/**
 * @typedef {{ id: string, name: string, initial: string, open: boolean, available: boolean,
 *   reason?: string }} Tile
 */

/**
 * One tile per UI plugin that opens on the desk, in plugin.list order. A failed plugin keeps its
 * tile, unavailable, so people see why it is missing; without a manifest nothing says where it opens.
 * @param {import("@endue-ai/bridge").PluginInfo[]} plugins
 * @returns {Tile[]}
 */
export function tiles(plugins) {
  return plugins.filter(opensOnDesk).map((plugin) => {
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
  });
}

/** @param {import("@endue-ai/bridge").PluginInfo} plugin */
function opensOnDesk(plugin) {
  const manifest = plugin.manifest;
  if (manifest?.kind !== "ui") return false;
  const placement = manifest.surfaces?.[0]?.placement;
  return placement === undefined || ON_DESK.has(placement);
}
