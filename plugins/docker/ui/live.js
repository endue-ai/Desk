// Keeping the screen current without the person pressing g: resource use sampled while the
// containers list shows, and engine events turned into one refresh of what they changed once a
// burst is over. Lists that are not on screen are only marked, and read fresh when they show.

/**
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {import("./parse-engine.js").Stats} Stats
 */

/** Events within this window refresh once. */
export const EVENT_QUIET_MS = 250;

/** Which lists an event of each type changes. @type {Record<string, ListName[]>} */
const AFFECTS = {
  container: ["containers", "compose", "images"],
  image: ["images"],
  volume: ["volumes"],
  network: ["networks"],
};

/**
 * @param {object} deps
 * @param {Clock} deps.clock
 * @param {() => ViewName} deps.current
 * @param {() => number} deps.interval Seconds between samples; 0 is off.
 * @param {() => boolean} deps.anyRunning
 * @param {() => Promise<Map<string, Stats>>} deps.sample
 * @param {(stats: Map<string, Stats>) => void} deps.sampled
 * @param {(name: ListName) => Promise<unknown>} deps.load
 * @param {(name: ListName) => void} deps.forget
 * @param {() => string | undefined} deps.detailId
 * @param {() => Promise<unknown>} deps.reloadDetail
 * @param {(error: unknown) => void} deps.failed
 */
export function createLive(deps) {
  const { clock } = deps;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let statsTimer = null;
  let sampling = false;

  /** Sample resource use now (`first`) or after the interval, while the containers show. */
  const scheduleStats = (/** @type {boolean} */ first) => {
    if (statsTimer !== null) clock.clearTimeout(statsTimer);
    statsTimer = null;
    if (deps.current() !== "containers" || deps.interval() === 0 || sampling) return;
    if (!deps.anyRunning()) return;
    statsTimer = clock.setTimeout(
      async () => {
        statsTimer = null;
        sampling = true;
        try {
          deps.sampled(await deps.sample());
        } catch {
          // Resource use is extra: a failed sample keeps the last one and tries again later.
        } finally {
          sampling = false;
        }
        scheduleStats(false);
      },
      first ? 0 : deps.interval() * 1000,
    );
  };

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
      const again = detailStale && deps.current() === "inspect";
      detailStale = false;
      for (const name of lists) {
        if (name === deps.current()) void deps.load(name).catch(deps.failed);
        else deps.forget(name);
      }
      if (again) void deps.reloadDetail().catch(deps.failed);
    }, EVENT_QUIET_MS);
  };

  return {
    scheduleStats,
    invalidate,
    stop() {
      if (statsTimer !== null) clock.clearTimeout(statsTimer);
      if (quiet !== null) clock.clearTimeout(quiet);
      statsTimer = null;
      quiet = null;
    },
  };
}
