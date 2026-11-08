// Keeping the screen current without the person pressing g: engine events turned into one refresh
// of what they changed once a burst is over. The list on screen and the container in the pane are
// read again; lists that are not on screen are only forgotten, and read fresh when they show.
// Resource use comes from its own stream (stats.js).

/**
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {import("./docker.js").ListName} ListName
 */

/** Events within this window refresh once. */
export const EVENT_QUIET_MS = 250;

/** Which lists an event of each type changes. @type {Record<string, ListName[]>} */
const AFFECTS = {
  container: ["overview", "containers", "compose", "images"],
  image: ["overview", "images"],
  volume: ["overview", "volumes"],
  network: ["overview", "networks"],
};

/**
 * @param {object} deps
 * @param {Clock} deps.clock
 * @param {() => ListName} deps.shown The list on screen.
 * @param {(name: ListName) => Promise<unknown>} deps.load
 * @param {(name: ListName) => void} deps.forget
 * @param {() => string | undefined} deps.detailId The container whose detail the pane shows.
 * @param {() => Promise<unknown>} deps.reloadDetail
 * @param {(error: unknown) => void} deps.failed
 */
export function createLive(deps) {
  const { clock } = deps;
  /** @type {Set<ListName>} */
  const stale = new Set();
  let detailStale = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let quiet = null;

  /** An event changed something of `type`: refresh what shows it once the burst is over. */
  const invalidate = (/** @type {string} */ type, /** @type {string} */ id) => {
    for (const name of AFFECTS[type] ?? []) stale.add(name);
    if (type === "container" && id !== "" && deps.detailId() === id) detailStale = true;
    if (quiet !== null) return;
    quiet = clock.setTimeout(() => {
      quiet = null;
      const lists = [...stale];
      stale.clear();
      const again = detailStale && deps.detailId() !== undefined;
      detailStale = false;
      for (const name of lists) {
        if (name === deps.shown()) void deps.load(name).catch(deps.failed);
        else deps.forget(name);
      }
      if (again) void deps.reloadDetail().catch(deps.failed);
    }, EVENT_QUIET_MS);
  };

  return {
    invalidate,
    stop() {
      if (quiet !== null) clock.clearTimeout(quiet);
      quiet = null;
    },
  };
}
