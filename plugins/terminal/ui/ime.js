// Korean (and every other) IME composition into the terminal, so a syllable is never dropped or
// doubled (TERM-E02). xterm sends a composition's text from two places: on the key that ends it,
// while the composition still runs (Enter, an arrow), and in a timeout after compositionend; WebKit
// fires both for one syllable, so the shell got `한\r한`. While a composition runs this holds what
// xterm sends; at compositionend it sends the committed text (the event's own data) once, then what
// was held that is not composition text, in order, and it drops xterm's late copy of the same text.
// No DOM: view.js feeds it the textarea's composition events and xterm's onData.

/**
 * @param {{
 *   send(data: string): void,
 *   defer?: (callback: () => void) => unknown,
 *   later?: (callback: () => void, ms: number) => unknown,
 *   cancel?: (handle: unknown) => void,
 * }} deps
 */
export function createImeGuard({
  send,
  defer = (callback) => setTimeout(callback, 0),
  later = (callback, ms) => setTimeout(callback, ms),
  cancel = (handle) => clearTimeout(/** @type {any} */ (handle)),
}) {
  let composing = false;
  /** What the composition showed on its way: `ㅎ`, `하`, `한`. @type {Set<string>} */
  let shown = new Set();
  /** @type {string[]} */
  let held = [];
  /** The committed text xterm may still send late. @type {string | null} */
  let echo = null;
  /** @type {unknown} */
  let safety = null;

  /** A composition that never ends (a lost compositionend) lets go of what it held. */
  const flush = () => {
    safety = null;
    const out = held;
    held = [];
    for (const data of out) send(data);
  };

  return {
    /** xterm's onData. */
    data(/** @type {string} */ text) {
      let data = text;
      if (echo !== null && data.startsWith(echo)) {
        data = data.slice(echo.length);
        echo = null;
        if (data === "") return;
      }
      if (composing) held.push(data);
      else send(data);
    },
    start() {
      if (held.length > 0) flush();
      composing = true;
      shown = new Set();
      if (safety !== null) cancel(safety);
      safety = later(flush, 2000);
    },
    update(/** @type {string} */ data) {
      if (data) shown.add(data);
    },
    end(/** @type {string} */ committed) {
      composing = false;
      if (safety !== null) cancel(safety);
      safety = null;
      if (!committed) {
        flush();
        return;
      }
      const rest = held.filter((data) => data !== committed && !shown.has(data));
      held = [];
      send(committed);
      for (const data of rest) send(data);
      echo = committed;
      // xterm's own timeout was queued first, at its compositionend listener: it runs before this.
      defer(() => {
        echo = null;
      });
    },
  };
}
