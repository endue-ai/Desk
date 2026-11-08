// The engine's event stream (`docker events`) kept running while the plugin is mounted: each event
// goes to the controller (which refreshes what is on screen) and to the alerts, and when the stream
// ends (the daemon restarted, Docker Desktop quit) it starts again after 1, 2, 4 … 30 seconds. A
// failure no retry can fix (no docker program, no grant) stops it. The alerts decide which events
// the person hears about: a container that failed on its own, ran out of memory or went unhealthy.

import { parseEvent } from "./parse-engine.js";

/**
 * @typedef {import("./parse-engine.js").DockerEvent} DockerEvent
 * @typedef {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout, now(): number }} Clock
 * @typedef {"watching" | "retrying" | "stopped"} WatchState
 * @typedef {{ title: string, body: string, level: "warning" | "error" }} Alert
 */

/** The object types whose events change what the views show. */
export const EVENT_TYPES = Object.freeze(["container", "image", "volume", "network"]);

export const EVENT_ARGS = Object.freeze([
  "events",
  "--format",
  "{{json .}}",
  ...EVENT_TYPES.flatMap((type) => ["--filter", `type=${type}`]),
]);

const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
/** Failures a retry cannot fix. */
const FINAL = new Set(["missing", "unsupported", "denied", "context"]);

/**
 * The platform's timers. Called through wrappers: a browser throws "Illegal invocation" when
 * setTimeout runs with another object as `this`.
 * @type {Clock}
 */
export const SYSTEM_CLOCK = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  now: () => Date.now(),
};

/**
 * @param {object} deps
 * @param {{ stream: ReturnType<typeof import("./run.js").createRunner>["stream"] }} deps.runner
 * @param {(event: DockerEvent) => void} deps.onEvent
 * @param {(state: WatchState, message: string) => void} [deps.onState]
 * @param {Clock} [deps.clock]
 */
export function createWatcher({ runner, onEvent, onState = () => {}, clock = SYSTEM_CLOCK }) {
  /** @type {{ stop(): Promise<void> } | null} */
  let handle = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let delay = FIRST_DELAY_MS;
  let wanted = false;
  /** Counts starts, so the exit of an old stream is not taken for the new one's. */
  let run = 0;

  const retry = (/** @type {string} */ message) => {
    if (!wanted) return;
    onState("retrying", message);
    timer = clock.setTimeout(() => {
      timer = null;
      void begin();
    }, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  };

  let starting = false;
  const begin = async () => {
    if (!wanted || handle || starting) return;
    starting = true;
    const mine = ++run;
    const since = clock.now();
    let ended = false;
    try {
      const started = await runner.stream([...EVENT_ARGS], {
        onLine: (stream, line) => {
          if (stream !== "stdout") return;
          const event = parseEvent(line);
          if (!event) return;
          // The stream works: the next failure starts the waits from the beginning again.
          delay = FIRST_DELAY_MS;
          onEvent(event);
        },
        onExit: (outcome) => {
          ended = true;
          if (mine !== run) return;
          handle = null;
          if (!wanted) return;
          // A stream that ran a good while was healthy: wait from the beginning again.
          if (clock.now() - since >= MAX_DELAY_MS) delay = FIRST_DELAY_MS;
          const said = outcome.stderr.trim().split("\n").pop() ?? "";
          retry(said || "The engine's event stream ended.");
        },
      });
      if (mine !== run || !wanted) {
        await started.stop();
        return;
      }
      // It may have ended already, with the events that came before the spawn answer.
      if (ended) return;
      handle = started;
      onState("watching", "");
    } catch (error) {
      const kind = /** @type {{ kind?: string }} */ (error)?.kind ?? "";
      const message = error instanceof Error ? error.message : String(error);
      if (FINAL.has(kind)) {
        wanted = false;
        onState("stopped", message);
      } else retry(message);
    } finally {
      starting = false;
    }
  };

  return {
    /** Start watching (again); a no-op while watching. */
    start() {
      wanted = true;
      delay = FIRST_DELAY_MS;
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      void begin();
    },
    /** Stop watching and end the stream. */
    async stop() {
      wanted = false;
      run++;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      const running = handle;
      handle = null;
      await running?.stop();
    },
    watching: () => handle !== null,
  };
}

/** How long a stop or kill explains the exit that follows it. */
const EXPECTED_MS = 60_000;
/** The same alert for the same container at most this often (a restart loop). */
const REPEAT_MS = 60_000;

/**
 * @param {object} deps
 * @param {(alert: Alert) => void} deps.notify
 * @param {() => "failures" | "none"} deps.mode
 * @param {() => number} [deps.now]
 */
export function createAlerts({ notify, mode, now = () => Date.now() }) {
  /** Container id -> when it was last stopped or killed on purpose. */
  const stopped = new Map();
  /** "id:kind" -> when it was last said. */
  const said = new Map();

  const say = (
    /** @type {string} */ id,
    /** @type {string} */ kind,
    /** @type {Alert} */ alert,
  ) => {
    const key = `${id}:${kind}`;
    const last = said.get(key);
    if (last !== undefined && now() - last < REPEAT_MS) return null;
    said.set(key, now());
    notify(alert);
    return alert;
  };

  return {
    /** The plugin itself is about to stop, kill, restart or remove this container. */
    expect(/** @type {string} */ id) {
      stopped.set(id, now());
    },
    /**
     * Hear one event; the alert it raised, if any.
     * @param {DockerEvent} event
     * @returns {Alert | null}
     */
    feed(event) {
      if (event.type !== "container") return null;
      const { id, action } = event;
      const name = event.name || id.slice(0, 12);
      if (action === "kill" || action === "stop") {
        stopped.set(id, now());
        return null;
      }
      if (action === "destroy") {
        stopped.delete(id);
        return null;
      }
      if (mode() === "none") return null;
      if (action === "oom")
        return say(id, "oom", {
          level: "error",
          title: `${name} ran out of memory`,
          body: "The kernel killed its process. Raise its memory limit or find the leak.",
        });
      if (action === "health_status" && event.detail === "unhealthy")
        return say(id, "unhealthy", {
          level: "warning",
          title: `${name} is unhealthy`,
          body: "Its health check failed. The detail view shows the last checks.",
        });
      if (action !== "die") return null;
      const code = event.attributes.exitCode ?? "";
      // The plugin may have stopped it by name; docker's own events name it by id.
      const on = stopped.get(id) ?? stopped.get(event.name);
      if (code === "0" || code === "" || (on !== undefined && now() - on < EXPECTED_MS))
        return null;
      return say(id, "die", {
        level: "warning",
        title: `${name} stopped with exit code ${code}`,
        body: "It ended on its own. Its logs say why.",
      });
    },
  };
}
