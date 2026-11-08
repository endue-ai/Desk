// Where long files were left: for files longer than ten minutes the position is kept with store.set
// (one key, the newest hundred files) and the next visit offers to resume there. The setting
// endue.player.resume turns both off.

const KEY = "resume";
const LONG = 600;
const KEEP = 100;
/** How often a playing file's position is written, at most. */
const EVERY_MS = 15_000;

/**
 * @typedef {{ path: string, t: number, d: number }} Kept
 */

/**
 * @param {{ call: import("@endue-ai/plugin-sdk").PluginContext["bridge"]["call"] }} bridge
 * @param {() => number} now
 */
export function createResume(bridge, now) {
  /** @type {Kept[]} */
  let kept = [];
  let on = true;
  let loaded = false;
  let wroteAt = 0;

  const write = () => {
    wroteAt = now();
    bridge.call("store.set", { key: KEY, value: kept }).catch(() => {});
  };

  return {
    /** Read the setting and the kept positions; call once at start. */
    async load() {
      const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
      const settings = /** @type {Record<string, unknown> | undefined} */ (init.settings);
      const setting = settings?.["endue.player.resume"];
      on = typeof setting === "boolean" ? setting : true;
      const stored = await bridge
        .call("store.get", { key: KEY })
        .catch(() => ({ value: undefined }));
      const value = /** @type {{ value?: unknown }} */ (stored).value;
      kept = Array.isArray(value)
        ? value.filter(
            (k) => typeof k?.path === "string" && Number.isFinite(k?.t) && Number.isFinite(k?.d),
          )
        : [];
      loaded = true;
    },
    /** Where to offer to resume `path`, or null. */
    offer(/** @type {string} */ path) {
      if (!on || !loaded) return null;
      const found = kept.find((k) => k.path === path);
      return found && found.d > LONG && found.t > 5 && found.t < found.d - 10 ? found.t : null;
    },
    /**
     * The person is at `time` of `duration` in `path`; `now` writes at once (a pause, a close).
     * @param {string} path
     * @param {number} time
     * @param {number} duration
     * @param {boolean} [urgent]
     */
    note(path, time, duration, urgent = false) {
      if (!on || !loaded || !(duration > LONG) || !Number.isFinite(time)) return;
      const rest = kept.filter((k) => k.path !== path);
      const near = time < 5 || time > duration - 10;
      const before = kept.find((k) => k.path === path);
      if (near && !before) return;
      kept = near
        ? rest
        : [{ path, t: Math.floor(time), d: Math.round(duration) }, ...rest].slice(0, KEEP);
      if (urgent || near || now() - wroteAt >= EVERY_MS) write();
    },
    /** The file ended: nothing to resume. */
    clear(/** @type {string} */ path) {
      if (!on || !kept.some((k) => k.path === path)) return;
      kept = kept.filter((k) => k.path !== path);
      write();
    },
  };
}
