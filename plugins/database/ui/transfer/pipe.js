// The stream between a copy's two sessions (PG-63): the source's COPY ... TO STDOUT writes into the
// pipe's sink (copy/stream.js) and the target's COPY ... FROM STDIN reads from its source. It holds
// one chunk: a write waits until the reader took the one before, so neither side holds more than
// that whatever the table's size. The end of the source ends the reader; a failure on either side,
// or the run's cancel, fails the other's next wait. No DOM.

/**
 * @typedef {import("../copy/stream.js").Chunk} Chunk
 * @typedef {import("../copy/stream.js").Sink} Sink
 * @typedef {import("../copy/stream.js").Source} Source
 */

/**
 * A pipe of one chunk.
 * @param {AbortSignal} [signal] fails both sides once it aborts
 * @returns {{ sink: Sink, source: Source, fail(error: Error): void }}
 */
export function createPipe(signal) {
  /** @type {Chunk | undefined} */
  let held;
  let ended = false;
  /** @type {Error | undefined} */
  let failed;
  /** Whoever waits for the other side. @type {(() => void) | undefined} */
  let wake;
  const nudge = () => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };
  const wait = () =>
    new Promise((resolve) => {
      wake = () => resolve(undefined);
    });
  const fail = (/** @type {Error} */ error) => {
    failed ??= error;
    nudge();
  };
  const cancelled = () => fail(new Error("Cancelled."));
  if (signal?.aborted) cancelled();
  else signal?.addEventListener("abort", cancelled, { once: true });

  return {
    fail,
    sink: {
      async write(chunk) {
        while (held && !failed) await wait();
        if (failed) throw failed;
        held = chunk;
        nudge();
      },
      async close() {
        while (held && !failed) await wait();
        if (failed) throw failed;
        ended = true;
        nudge();
      },
    },
    source: {
      async read() {
        while (!held && !ended && !failed) await wait();
        if (failed) throw failed;
        const chunk = held;
        held = undefined;
        nudge();
        return chunk;
      },
    },
  };
}
