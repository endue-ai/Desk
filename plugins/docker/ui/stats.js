// Resource use as it happens: one `docker stats` stream (no --no-stream) while containers are on
// screen, instead of a two-second sample every few seconds. docker redraws a frame of JSON lines with
// ANSI cursor codes between them, often twice a second with the same numbers; each line is read on its
// own, and each container keeps a ring of points spaced `spacing` apart: CPU %, memory in bytes and
// network bytes per second, which the sparklines draw. The newest point follows every frame.

import { stripAnsi } from "./errors.js";
import { parseSize } from "./overview.js";
import { parseStats } from "./parse-engine.js";

/**
 * @typedef {import("./parse-engine.js").Stats} Stats
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {{ cpu: number[], mem: number[], net: number[], at: number, netBytes: number,
 *   netAt: number, latest: Stats }} Series
 * @typedef {{ cpu: number[], mem: number[], net: number[], latest: Stats, memBytes: number,
 *   memLimit: number, rate: number }} Snapshot
 */

export const STREAM_ARGS = Object.freeze(["stats", "--no-trunc", "--format", "{{json .}}"]);
/** How many points a sparkline keeps. */
export const POINTS = 60;
/** How long a stream that ended waits before it starts again. */
const RESTART_MS = 5_000;
/** The view hears at most this often. */
const FLUSH_MS = 500;

/** One line of the stream as a sample, or undefined for a frame's cursor codes. */
export function parseStatsLine(/** @type {string} */ line) {
  const text = stripAnsi(line).trim();
  if (!text.startsWith("{")) return undefined;
  return parseStats(text).values().next().value;
}

/** "24.3MB / 42.5MB" as the bytes in and out. */
export function ioBytes(/** @type {string} */ text) {
  const [a = "", b = ""] = text.split("/");
  return { in: parseSize(a.trim()), out: parseSize(b.trim()) };
}

/** @param {{ points?: number, spacing: () => number }} options `spacing` in milliseconds. */
export function createHistory({ points = POINTS, spacing }) {
  /** @type {Map<string, Series>} */
  const series = new Map();

  /** Add a value: a new point when the last is older than the spacing, else the last one again. */
  const put = (
    /** @type {number[]} */ ring,
    /** @type {number} */ value,
    /** @type {boolean} */ fresh,
  ) => {
    if (fresh || ring.length === 0) {
      ring.push(value);
      if (ring.length > points) ring.shift();
    } else ring[ring.length - 1] = value;
  };

  return {
    /** Take one sample in at `now`. */
    feed(/** @type {Stats} */ stats, /** @type {number} */ now) {
      const id = stats.id;
      const net = ioBytes(stats.net);
      const bytes = net.in + net.out;
      const mem = parseSize(stats.memText.split("/")[0]?.trim() ?? "");
      let s = series.get(id);
      if (!s) {
        s = {
          cpu: [],
          mem: [],
          net: [],
          at: -Infinity,
          netBytes: bytes,
          netAt: now,
          latest: stats,
        };
        series.set(id, s);
        if (stats.id.length > 12) series.set(stats.id.slice(0, 12), s);
      }
      const fresh = now - s.at >= spacing();
      const seconds = (now - s.netAt) / 1000;
      // A counter that went back (the container restarted) starts the rate again from zero.
      const rate = seconds > 0 && bytes >= s.netBytes ? (bytes - s.netBytes) / seconds : 0;
      put(s.cpu, stats.cpu, fresh);
      put(s.mem, mem, fresh);
      if (seconds >= 1 || s.net.length === 0) {
        put(s.net, Math.round(rate), fresh);
        s.netBytes = bytes;
        s.netAt = now;
      }
      if (fresh) s.at = now;
      s.latest = stats;
    },
    /** What a container's sparklines draw, or undefined before its first sample. */
    snapshot(/** @type {string} */ id) {
      const s = series.get(id) ?? series.get(id.slice(0, 12));
      if (!s) return undefined;
      const [used = "", limit = ""] = s.latest.memText.split("/");
      return /** @type {Snapshot} */ ({
        cpu: [...s.cpu],
        mem: [...s.mem],
        net: [...s.net],
        latest: s.latest,
        memBytes: parseSize(used.trim()),
        memLimit: parseSize(limit.trim()),
        rate: s.net.at(-1) ?? 0,
      });
    },
    /** The latest sample of every container, as `stats --no-stream` would give. */
    latest() {
      /** @type {Map<string, Stats>} */
      const out = new Map();
      for (const s of new Set(series.values())) out.set(s.latest.id, s.latest);
      return out;
    },
    /** Drop the containers not in `ids` (they stopped or went away). */
    keep(/** @type {Set<string>} */ ids) {
      for (const [id, s] of series)
        if (!ids.has(s.latest.id) && !ids.has(s.latest.id.slice(0, 12))) series.delete(id);
    },
    clear: () => series.clear(),
  };
}

/**
 * The stream itself: started while something on screen shows resource use, stopped otherwise, and
 * started again after it ends on its own (the engine restarted).
 * @param {object} deps
 * @param {{ stream: ReturnType<typeof import("./run.js").createRunner>["stream"] }} deps.runner
 * @param {Clock} deps.clock
 * @param {ReturnType<typeof createHistory>} deps.history
 * @param {() => void} deps.changed Called at most every half second while samples come.
 */
export function createStatsStream({ runner, clock, history, changed }) {
  /** @type {{ stop(): Promise<void> } | null} */
  let handle = null;
  let wanted = false;
  let starting = false;
  let run = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let flush = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let again = null;

  const later = () => {
    if (flush !== null) return;
    flush = clock.setTimeout(() => {
      flush = null;
      changed();
    }, FLUSH_MS);
  };

  const begin = async () => {
    if (!wanted || handle || starting) return;
    starting = true;
    const mine = ++run;
    try {
      const started = await runner.stream([...STREAM_ARGS], {
        onLine: (stream, line) => {
          if (stream !== "stdout" || mine !== run) return;
          const sample = parseStatsLine(line);
          if (!sample) return;
          history.feed(sample, clock.now());
          later();
        },
        onExit: () => {
          if (mine !== run) return;
          handle = null;
          if (wanted)
            again = clock.setTimeout(() => {
              again = null;
              void begin();
            }, RESTART_MS);
        },
      });
      if (mine !== run || !wanted) await started.stop();
      else handle = started;
    } catch {
      // Resource use is extra: no stream leaves the numbers out, and the next start tries again.
    } finally {
      starting = false;
    }
  };

  return {
    /** Stream while `on`; stop the process when not. */
    want(/** @type {boolean} */ on) {
      if (on === wanted) return;
      wanted = on;
      if (on) void begin();
      else void this.stop();
    },
    async stop() {
      wanted = false;
      run++;
      for (const timer of [flush, again]) if (timer !== null) clock.clearTimeout(timer);
      flush = null;
      again = null;
      const running = handle;
      handle = null;
      await running?.stop();
    },
    streaming: () => handle !== null,
  };
}

/**
 * Resource use for the controller: the history, what the view reads from it, and the stream.
 * @param {object} deps
 * @param {Parameters<typeof createStatsStream>[0]["runner"]} deps.runner
 * @param {Clock} deps.clock
 * @param {() => number} deps.interval Seconds between the sparklines' points.
 * @param {(read: ((id: string) => Snapshot | undefined) & { latest(): Map<string, Stats> }) => void} deps.show
 */
export function createUse({ runner, clock, interval, show }) {
  const history = createHistory({ spacing: () => Math.max(1, interval()) * 1000 });
  const read = Object.assign((/** @type {string} */ id) => history.snapshot(id), {
    latest: () => history.latest(),
  });
  const stream = createStatsStream({ runner, clock, history, changed: () => show(read) });
  return { history, read, stream };
}
