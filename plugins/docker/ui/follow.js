// Following the engine: its event stream (watch.js), which feeds the alerts and the live refresh,
// and, while the engine does not answer, the wait for it (reach.js), so no docker runs against an
// engine that is away but a `docker version` now and then. The controller hears when to read the
// screen again (`reread`: the engine is back) and when what streams may change (`changed`).

import { createWait } from "./reach.js";
import { createAlerts, createWatcher, FINAL } from "./watch.js";

/**
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {import("./parse-engine.js").DockerEvent} DockerEvent
 */

/**
 * @param {object} deps
 * @param {Parameters<typeof createWatcher>[0]["runner"]} deps.runner
 * @param {Clock} deps.clock
 * @param {Pick<ReturnType<typeof import("./engine.js").createEngine>, "probe" | "header" | "kind">} deps.engine
 * @param {import("./reach.js").Page} [deps.page]
 * @param {Parameters<typeof createAlerts>[0]["notify"]} deps.notify
 * @param {Parameters<typeof createAlerts>[0]["mode"]} deps.mode
 * @param {(event: DockerEvent) => void} deps.onEvent
 * @param {() => void} deps.reread
 * @param {() => void} deps.changed
 */
export function createFollow({
  runner,
  clock,
  engine,
  page,
  notify,
  mode,
  onEvent,
  reread,
  changed,
}) {
  /** Whether the event stream ended and is being started again. */
  let lost = false;
  const alerts = createAlerts({ notify, mode, now: clock.now });

  const watcher = createWatcher({
    runner,
    clock,
    reachable: () => engine.probe(),
    onEvent: (event) => {
      alerts.feed(event);
      onEvent(event);
    },
    onState: (state) => {
      engine.header();
      // Back after the stream ended while the engine answered: read what is on screen again.
      if (state === "watching" && lost) reread();
      lost = state === "retrying";
      if (state === "away") away();
      changed();
    },
  });

  const wait = createWait({
    clock,
    probe: () => engine.probe(),
    back: () => {
      watcher.start();
      changed();
      reread();
    },
    ...(page ? { page } : {}),
  });

  /** The engine did not answer: wait for it, unless only the person can change why (FINAL). */
  const away = () => {
    if (!FINAL.has(engine.kind())) wait.start();
  };

  return {
    /** The plugin is about to stop, kill, restart or remove this container: no alert for it. */
    expect: (/** @type {string} */ id) => alerts.expect(id),
    watching: () => watcher.watching(),
    /** The engine answered: follow its events (again). */
    start() {
      wait.stop();
      watcher.start();
    },
    away,
    /** A read worked while waiting: ask the engine at once rather than at the next ask's time. */
    now: () => wait.now(),
    async stop() {
      wait.stop();
      await watcher.stop();
    },
  };
}
