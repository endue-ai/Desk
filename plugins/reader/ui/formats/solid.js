// One pass through a solid archive. Its entries can only be decoded in the archive's order, from
// the start, so the pages are decoded once by the library's each() and handed over as they come
// out; the pages out are kept for the rest of the visit. The pass runs while a page is waited for
// and pauses, keeping its place and its decoder, as soon as nobody waits (Cancel, or the view moving
// on); the next page asked for wakes it. A pass that fails gives its sentence to every page after.

const cancelled = (/** @type {AbortSignal | undefined} */ signal) =>
  signal?.reason instanceof Error && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Decoding was cancelled.", "AbortError");

/**
 * @template E
 * @typedef {(entries: E[], visit: (entry: E, bytes: Uint8Array) => Promise<unknown>) => Promise<void>} Each
 * @typedef {(done: number, total: number) => void} Report
 * @typedef {{ entry: E, need: number, report?: Report, resolve(bytes: Uint8Array): void, reject(error: unknown): void }} Waiter
 */

/**
 * @template E
 * @param {Each<E>} each the library's pass over entries, in the archive's order
 * @param {E[]} order the entries to decode, in the archive's order
 * @param {(entry: E) => number} sizeOf an entry's decoded size, for progress
 */
export function createPass(each, order, sizeOf) {
  /** Bytes to decode up to and including each entry. @type {Map<E, number>} */
  const needs = new Map();
  let sum = 0;
  for (const entry of order) {
    sum += Math.max(0, sizeOf(entry));
    needs.set(entry, sum);
  }
  /** @type {Map<E, Uint8Array>} */
  const out = new Map();
  /** @type {Set<Waiter<E>>} */
  const waiters = new Set();
  let done = 0;
  /** @type {Promise<void> | undefined} */
  let running;
  /** @type {unknown} */
  let failure;
  let closed = false;
  /** @type {(() => void) | undefined} */
  let resume;
  const wake = () => {
    const run = resume;
    resume = undefined;
    run?.();
  };

  /** @param {E} entry @param {Uint8Array} bytes */
  const visit = async (entry, bytes) => {
    if (closed) throw cancelled(undefined);
    out.set(entry, bytes);
    done += Math.max(0, sizeOf(entry));
    for (const waiter of [...waiters]) {
      if (waiter.entry === entry) waiter.resolve(bytes);
      else waiter.report?.(Math.min(done, waiter.need), waiter.need);
    }
    // Nobody waits: keep the place until somebody does.
    while (!closed && waiters.size === 0)
      await new Promise((wakeUp) => {
        resume = () => wakeUp(undefined);
      });
    if (closed) throw cancelled(undefined);
  };

  const start = () => {
    running = each(
      order.filter((entry) => !out.has(entry)),
      visit,
    ).then(
      () => {
        for (const waiter of [...waiters])
          waiter.reject(new Error("The archive ends before this page."));
      },
      (error) => {
        if (!closed) failure = error;
        for (const waiter of [...waiters]) waiter.reject(error);
      },
    );
    void running.finally(() => {
      running = undefined;
    });
  };

  return {
    /**
     * An entry's bytes, once the pass has them. `signal` withdraws this wait.
     * @param {E} entry @param {AbortSignal} [signal] @param {Report} [report]
     * @returns {Promise<Uint8Array>}
     */
    want(entry, signal, report) {
      const have = out.get(entry);
      if (have) return Promise.resolve(have);
      if (closed || signal?.aborted) return Promise.reject(cancelled(signal));
      if (failure) return Promise.reject(failure);
      if (!needs.has(entry))
        return Promise.reject(new Error("The archive does not hold this page."));
      return new Promise((resolve, reject) => {
        const withdraw = () => waiter.reject(cancelled(signal));
        /** @type {Waiter<E>} */
        const waiter = {
          entry,
          need: needs.get(entry) ?? sum,
          report,
          resolve: (bytes) => {
            waiters.delete(waiter);
            signal?.removeEventListener("abort", withdraw);
            resolve(bytes);
          },
          reject: (error) => {
            waiters.delete(waiter);
            signal?.removeEventListener("abort", withdraw);
            reject(error);
          },
        };
        waiters.add(waiter);
        signal?.addEventListener("abort", withdraw, { once: true });
        report?.(Math.min(done, waiter.need), waiter.need);
        if (running) wake();
        else start();
      });
    },
    /** Stop for good: the archive is closed. */
    close() {
      closed = true;
      for (const waiter of [...waiters]) waiter.reject(cancelled(undefined));
      wake();
    },
  };
}
