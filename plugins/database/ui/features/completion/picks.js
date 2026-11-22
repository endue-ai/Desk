// What the person picked from the completion list (ADR 0327): how often and when each candidate was
// picked, by its key (kind and label), in the plugin's store under one small key. A candidate picked
// more often, then more lately, ranks first among equals (editor/rank.js). At most MAX_PICKS are
// kept; the one picked longest ago goes first. A store that cannot be read or written leaves the
// ranking as it is.

/**
 * @typedef {import("../../editor/rank.js").Picks} Picks
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

export const PICKS_KEY = "completion-picks";
export const MAX_PICKS = 200;
const MAX_KEY = 200;

/** A stored value as picks: entries of a key to [count, time], the rest left out. @returns {Picks} */
export function picksOf(/** @type {unknown} */ value) {
  /** @type {Picks} */
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > MAX_KEY || !Array.isArray(entry) || entry.length !== 2) continue;
    const [count, at] = entry;
    if (Number.isInteger(count) && count > 0 && Number.isFinite(at)) out[key] = [count, at];
  }
  return trimmed(out);
}

/** The picks without the oldest past MAX_PICKS. @returns {Picks} */
function trimmed(/** @type {Picks} */ picks) {
  const entries = Object.entries(picks);
  if (entries.length <= MAX_PICKS) return picks;
  entries.sort((a, b) => b[1][1] - a[1][1]);
  return Object.fromEntries(entries.slice(0, MAX_PICKS));
}

/** @type {WeakMap<object, ReturnType<typeof createPicks>>} */
const shared = new WeakMap();

/** The one picks of a plugin's bridge, which the list reads and each pick writes. */
export function picksFor(/** @type {Bridge} */ bridge) {
  let found = shared.get(bridge);
  if (!found) {
    found = createPicks(bridge);
    shared.set(bridge, found);
  }
  return found;
}

/**
 * @param {Bridge} bridge
 * @param {() => number} [now]
 */
export function createPicks(bridge, now = Date.now) {
  /** @type {Picks} */
  let picks = {};
  /** @type {Promise<void> | undefined} */
  let loaded;
  const load = () => {
    loaded ??= bridge
      .call("store.get", { key: PICKS_KEY })
      .then((kept) => {
        picks = { ...picksOf(/** @type {{ value?: unknown }} */ (kept)?.value), ...picks };
      })
      .catch(() => {});
    return loaded;
  };
  return {
    /** The picks, read from the store the first time. */
    async get() {
      await load();
      return picks;
    },
    /** One more pick of `key`, now. */
    async record(/** @type {string} */ key) {
      if (typeof key !== "string" || key === "" || key.length > MAX_KEY) return;
      await load();
      const [count] = picks[key] ?? [0, 0];
      picks = trimmed({ ...picks, [key]: [count + 1, now()] });
      await bridge.call("store.set", { key: PICKS_KEY, value: picks }).catch(() => {});
    },
  };
}
