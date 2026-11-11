// Waiting for an engine docker cannot reach (none runs, Docker Desktop quit, the context's socket is
// gone): no event stream and no reads against it, only `docker version` now and then, 5, 10, 20 and
// 40 seconds apart and then once a minute, and only while the page can be seen. A page shown again
// asks at once when an ask fell due while it was out of sight. The first answer hands the engine
// back (`back`), which starts the event stream and reads the screen again.

/**
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {{ hidden(): boolean, onShown(fn: () => void): void }} Page
 */

export const FIRST_ASK_MS = 5_000;
export const MAX_ASK_MS = 60_000;

/** A page that is always in sight (no document: the tests, a worker). @type {Page} */
export const ALWAYS_SHOWN = Object.freeze({ hidden: () => false, onShown: () => {} });

/**
 * The browser's page: out of sight while the desk hides its window (another desktop, the drawer,
 * the app hidden), which the desk tells the page's browser.
 * @param {Document} doc
 * @returns {Page}
 */
export function pageOf(doc) {
  return {
    hidden: () => doc.visibilityState === "hidden",
    onShown: (fn) =>
      doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState !== "hidden") fn();
      }),
  };
}

/**
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.probe Ask the engine; true when it answered.
 * @param {() => void} deps.back The engine answered.
 * @param {Clock} deps.clock
 * @param {Page} [deps.page]
 */
export function createWait({ probe, back, clock, page = ALWAYS_SHOWN }) {
  let on = false;
  /** Counts starts and stops, so an answer to an older ask is not taken for the current wait. */
  let run = 0;
  let delay = FIRST_ASK_MS;
  /** An ask fell due while the page was out of sight. */
  let due = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** The wait (its `run`) whose ask is out: one at a time. */
  let asking = -1;

  const schedule = () => {
    timer = clock.setTimeout(() => {
      timer = null;
      void ask();
    }, delay);
    delay = Math.min(delay * 2, MAX_ASK_MS);
  };

  const ask = async () => {
    if (!on || asking === run) return;
    if (page.hidden()) {
      due = true;
      return;
    }
    const mine = run;
    asking = mine;
    const up = await probe().catch(() => false);
    if (asking === mine) asking = -1;
    if (mine !== run || !on) return;
    if (!up) return schedule();
    on = false;
    back();
  };

  page.onShown(() => {
    if (!on || !due) return;
    due = false;
    void ask();
  });

  return {
    /** The engine did not answer: ask after it from now on. A no-op while waiting. */
    start() {
      if (on) return;
      on = true;
      run++;
      delay = FIRST_ASK_MS;
      due = false;
      schedule();
    },
    /** Ask at once instead of at the next ask's time (a read just worked). */
    now() {
      if (!on || asking === run) return;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      void ask();
    },
    /** Stop asking (it answered some other way, or the plugin goes). */
    stop() {
      on = false;
      run++;
      due = false;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
    waiting: () => on,
  };
}
