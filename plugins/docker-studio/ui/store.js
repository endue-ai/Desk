// The studio's state in one place, and who listens: views subscribe to the keys they draw and are
// told once per frame, however many changes came in between. No DOM.

/**
 * @typedef {import("./parse.js").Container} Container
 * @typedef {import("./parse.js").Image} Image
 * @typedef {import("./parse.js").Volume} Volume
 * @typedef {import("./parse.js").Network} Network
 * @typedef {import("./parse.js").ProjectRow} ProjectRow
 * @typedef {import("./parse.js").DiskRow} DiskRow
 * @typedef {ReturnType<typeof import("./parse.js").engine>} EngineInfo
 * @typedef {{ status: "connecting" | "up" | "down", problem: string, kind: string, info: EngineInfo | null }} Engine
 * @typedef {{ kind: string, action: string, name: string, id: string, time: number, detail: string }} Activity
 * @typedef {{ engine: Engine, contexts: ReturnType<typeof import("./parse.js").contexts>,
 *   context: string, containers: Container[], images: Image[], volumes: Volume[],
 *   networks: Network[], projects: ProjectRow[], disk: DiskRow[], volumeSizes: Map<string, number>,
 *   loaded: Set<string>, activity: Activity[], busy: number, page: string, detail: any,
 *   selection: Set<string>, toast: any }} State
 * @typedef {keyof State} Key
 */

/** @returns {State} */
export const initial = () => ({
  engine: { status: "connecting", problem: "", kind: "", info: null },
  contexts: [],
  context: "",
  containers: [],
  images: [],
  volumes: [],
  networks: [],
  projects: [],
  disk: [],
  volumeSizes: new Map(),
  loaded: new Set(),
  activity: [],
  busy: 0,
  page: "dashboard",
  detail: null,
  selection: new Set(),
  toast: null,
});

/**
 * @param {(fn: () => void) => void} [schedule] How a batch of changes is told (a frame; tests: now).
 */
export function createStore(schedule = defaultSchedule) {
  const state = initial();
  /** @type {Set<{ keys: Set<string> | null, fn: (state: State, changed: Set<string>) => void }>} */
  const listeners = new Set();
  /** @type {Set<string>} */
  let pending = new Set();
  let queued = false;

  const flush = () => {
    queued = false;
    const changed = pending;
    pending = new Set();
    for (const listener of [...listeners]) {
      if (listener.keys && ![...changed].some((key) => listener.keys?.has(key))) continue;
      listener.fn(state, changed);
    }
  };

  return {
    state,
    /** Change some keys and tell who listens to them. @param {Partial<State>} patch */
    set(patch) {
      Object.assign(state, patch);
      for (const key of Object.keys(patch)) pending.add(key);
      if (!queued) {
        queued = true;
        schedule(flush);
      }
    },
    /** Say a key changed in place (a Map or Set mutated). @param {...Key} keys */
    touch(...keys) {
      for (const key of keys) pending.add(key);
      if (!queued) {
        queued = true;
        schedule(flush);
      }
    },
    /**
     * Listen to some keys (or every change with null); returns the unsubscribe.
     * @param {Key[] | null} keys @param {(state: State, changed: Set<string>) => void} fn
     */
    on(keys, fn) {
      const entry = { keys: keys ? new Set(keys) : null, fn };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    flush,
  };
}

function defaultSchedule(/** @type {() => void} */ fn) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

/** @typedef {ReturnType<typeof createStore>} Store */
