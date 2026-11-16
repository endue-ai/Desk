// What keeps the studio current: one `docker events` stream reloads the lists an event touches (a
// burst is one reload) and feeds the activity; one `docker stats` stream, while something on screen
// shows resource use, keeps a minute or two of samples per container and of their sum. While no
// engine answers, `docker version` is asked again every few seconds, only while the page is seen.

import { notable, event as parseEvent, sample, touches } from "./parse-live.js";

/**
 * @typedef {import("./parse-live.js").Sample} Sample
 * @typedef {{ cpu: number[], mem: number[], netIn: number[], netOut: number[], latest: Sample }} History
 */

export const POINTS = 90;
const ACTIVITY = 120;

/**
 * @param {{ runner: ReturnType<typeof import("./run.js").createRunner>,
 *   store: import("./store.js").Store, engine: ReturnType<typeof import("./engine.js").createEngine>,
 *   visible?(): boolean }} deps
 */
export function createLive({ runner, store, engine, visible = () => true }) {
  /** @type {Map<string, History>} */
  const history = new Map();
  /** Sums over every container, one point per tick. */
  const total = { cpu: /** @type {number[]} */ ([]), mem: /** @type {number[]} */ ([]) };
  /** @type {import("./run.js").StreamHandle | null} */
  let events = null;
  /** @type {import("./run.js").StreamHandle | null} */
  let stats = null;
  let statsWanted = false;
  /** @type {Set<string>} */
  const dirty = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let reloadTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer;
  /** Samples of the tick being read; a tick ends when a container shows up twice. */
  /** @type {Map<string, Sample>} */
  let tick = new Map();

  const push = (/** @type {number[]} */ list, /** @type {number} */ value) => {
    list.push(value);
    if (list.length > POINTS) list.shift();
  };

  const endTick = () => {
    if (tick.size === 0) return;
    let cpu = 0;
    let mem = 0;
    for (const s of tick.values()) {
      cpu += s.cpu;
      mem += s.mem;
      const h = history.get(s.id) ?? { cpu: [], mem: [], netIn: [], netOut: [], latest: s };
      push(h.cpu, s.cpu);
      push(h.mem, s.mem);
      push(h.netIn, s.netIn);
      push(h.netOut, s.netOut);
      h.latest = s;
      history.set(s.id, h);
    }
    push(total.cpu, cpu);
    push(total.mem, mem);
    tick = new Map();
    statsChanged();
  };

  /** @type {Set<() => void>} */
  const statsListeners = new Set();
  const statsChanged = () => {
    for (const fn of statsListeners) fn();
  };

  const reloadSoon = () => {
    if (reloadTimer !== undefined) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      const names = [...dirty];
      dirty.clear();
      for (const name of names) void engine.load(/** @type {any} */ (name)).catch(() => {});
      if (names.length > 0) void engine.load("disk").catch(() => {});
    }, 250);
  };

  const heard = (/** @type {string} */ line) => {
    const e = parseEvent(line);
    if (!e) return;
    for (const name of touches(e)) dirty.add(name);
    if (e.type === "container" && e.attributes["com.docker.compose.project"]) dirty.add("projects");
    if (dirty.size > 0) reloadSoon();
    if (!notable(e)) return;
    const detail =
      e.action === "die" && e.attributes.exitCode !== undefined
        ? `exit ${e.attributes.exitCode}`
        : e.action === "health_status"
          ? (e.attributes.health_status ?? "")
          : "";
    const activity = [
      { kind: e.type, action: e.action, name: e.name, id: e.id, time: e.time, detail },
      ...store.state.activity,
    ].slice(0, ACTIVITY);
    store.set({ activity });
  };

  const startEvents = async () => {
    if (events) return;
    try {
      // The last hour replays first, so the activity starts with what happened before the studio opened.
      const since = String(Math.floor(Date.now() / 1000) - 3600);
      events = await runner.stream(["events", "--since", since, "--format", "{{json .}}"], {
        onLine: (stream, line) => {
          if (stream === "stdout") heard(line);
        },
        onExit: () => {
          events = null;
          // The engine went away: say so and wait for it.
          if (store.state.engine.status === "up") void reconnect();
        },
      });
    } catch {
      events = null;
    }
  };

  const startStats = async () => {
    if (stats || !statsWanted || store.state.engine.status !== "up") return;
    try {
      stats = await runner.stream(["stats", "--no-trunc", "--format", "{{json .}}"], {
        onLine: (stream, line) => {
          if (stream !== "stdout") return;
          // Each tick starts by clearing the screen; a container seen twice also ends it.
          if (line.includes("\u001b[2J")) endTick();
          const s = sample(line);
          if (!s) return;
          if (tick.has(s.id)) endTick();
          tick.set(s.id, s);
        },
        onExit: () => {
          endTick();
          stats = null;
          if (statsWanted && store.state.engine.status === "up")
            retryTimer = setTimeout(() => void startStats(), 3000);
        },
      });
    } catch {
      stats = null;
    }
  };

  /** Ask for the engine again until it answers, a few seconds apart, only while the page is seen. */
  const reconnect = async () => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!visible()) {
      retryTimer = setTimeout(() => void reconnect(), 5000);
      return;
    }
    const up = await engine.loadAll();
    if (up) {
      void startEvents();
      void startStats();
    } else retryTimer = setTimeout(() => void reconnect(), 8000);
  };

  return {
    history,
    total,
    /** Connect, read everything, then follow the events. */
    start: () => reconnect(),
    /** Read everything again now (Refresh). */
    refresh: () => reconnect(),
    /** Stream resource use while something on screen shows it. */
    wantStats(/** @type {boolean} */ want) {
      statsWanted = want;
      if (want) void startStats();
      else if (stats) {
        void stats.stop();
        stats = null;
      }
    },
    /** Hear every tick of resource use; returns the unsubscribe. */
    onStats(/** @type {() => void} */ fn) {
      statsListeners.add(fn);
      return () => statsListeners.delete(fn);
    },
    stop() {
      void events?.stop();
      void stats?.stop();
      events = null;
      stats = null;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    },
  };
}
