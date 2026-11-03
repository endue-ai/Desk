// Redraw at wall-clock minute boundaries while a calendar is shown.
import { MINUTE } from "./ical/values.js";

/**
 * @param {object} host
 * @param {() => number} host.now
 * @param {() => void} host.render
 * @param {(run: () => void, ms: number) => unknown} [host.setTimer]
 * @param {(timer: unknown) => void} [host.clearTimer]
 */
export function createTicker(host) {
  const setTimer = host.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = host.clearTimer ?? ((timer) => clearTimeout(/** @type {number} */ (timer)));
  /** @type {unknown} */
  let timer;
  let active = false;
  let stopped = false;

  const schedule = () => {
    const elapsed = ((host.now() % MINUTE) + MINUTE) % MINUTE;
    timer = setTimer(tick, MINUTE - elapsed);
  };
  const tick = () => {
    timer = undefined;
    if (!active || stopped) return;
    host.render();
    schedule();
  };
  const stop = () => {
    active = false;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  return {
    show(shown) {
      if (stopped || shown === active) return;
      if (!shown) return stop();
      active = true;
      schedule();
    },
    dispose() {
      stopped = true;
      stop();
    },
  };
}
