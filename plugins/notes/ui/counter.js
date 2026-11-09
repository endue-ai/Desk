// Counts a note in a worker (count-worker.js), so a long note neither stalls typing nor the desk
// (#38, ADR 0048). One count runs at a time; a newer text cancels it: the worker counting stops (a
// count cannot be interrupted otherwise) and a fresh one starts on the next count.

/**
 * @typedef {import("./count.js").Counts} Counts
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{ count(text: string): Promise<Counts>, cancel(): void }} Counter
 */

const cancelled = () => new DOMException("Counting was cancelled.", "AbortError");

/** @param {StartWorker} startWorker @returns {Counter} */
export function createCounter(startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  /** @type {{ reject(error: unknown): void } | undefined} */
  let running;

  const stop = () => {
    worker?.terminate();
    worker = undefined;
  };
  const cancel = () => {
    if (!running) return;
    const { reject } = running;
    running = undefined;
    stop();
    reject(cancelled());
  };

  return {
    count(text) {
      cancel();
      worker ??= startWorker(new URL("./count-worker.js", import.meta.url), {
        name: "Notes counter",
      });
      const counting = worker;
      return new Promise((resolve, reject) => {
        const entry = { reject };
        running = entry;
        counting.onmessage = ({ data }) => {
          if (running !== entry) return;
          running = undefined;
          resolve(data);
        };
        counting.onerror = (event) => {
          if (running !== entry) return;
          running = undefined;
          stop();
          reject(new Error(event.message || "The counter stopped."));
        };
        counting.postMessage(text);
      });
    },
    cancel,
  };
}
