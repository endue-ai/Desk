// Where the source search's texts are matched: in place when a step's texts are small (or in tests,
// with no worker), in the worker (worker.js) from 64 KiB on, where a regular expression over big
// bodies would hold the frame's thread. One worker per search, ended with it; Cancel ends it at once.
import { matchTexts } from "./match.js";

/**
 * @typedef {import("../../explain/reader.js").StartWorker} StartWorker
 * @typedef {import("./match.js").Query} Query
 * @typedef {import("./match.js").Found} Found
 */

/** Steps with fewer characters than this are matched in place. */
export const INLINE_MAX = 64 * 1024;

/** @param {StartWorker} [startWorker] */
export function createMatcher(startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;

  /** End the worker, when one was started. */
  const stop = () => {
    worker?.terminate();
    worker = undefined;
  };

  /**
   * Match a step's texts.
   * @param {string[]} texts
   * @param {Query} query
   * @param {[number, number][][]} skips
   * @param {AbortSignal} signal
   * @returns {Promise<(Found | null)[]>}
   */
  const match = (texts, query, skips, signal) => {
    const size = texts.reduce((n, t) => n + t.length, 0);
    if (!startWorker || size < INLINE_MAX)
      return Promise.resolve().then(() => matchTexts(texts, query, skips));
    worker ??= startWorker(new URL("./worker.js", import.meta.url), {
      name: "Database source search",
    });
    const running = /** @type {Worker} */ (worker);
    const id = ++next;
    return new Promise((resolve, reject) => {
      const done = () => {
        signal.removeEventListener("abort", aborted);
        running.onmessage = null;
        running.onerror = null;
      };
      const aborted = () => {
        done();
        stop();
        reject(Object.assign(new Error("Cancelled."), { code: "cancelled" }));
      };
      signal.addEventListener("abort", aborted, { once: true });
      running.onmessage = ({ data }) => {
        if (data.id !== id) return;
        done();
        if ("error" in data) reject(new Error(data.error));
        else resolve(data.found);
      };
      running.onerror = (event) => {
        done();
        stop();
        reject(new Error(event.message || "The source search's worker stopped."));
      };
      running.postMessage({ id, texts, query, skips });
    });
  };

  return { match, stop };
}
