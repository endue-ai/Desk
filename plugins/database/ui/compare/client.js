// Where two results are compared (PG-26, ADR 0329): past INLINE_MAX cells (both results together)
// in the comparison's worker (worker.js), started with the SDK's startWorker for that comparison and
// let go when it answers, so the frame's thread never pairs two large results; below that, and
// without a worker (the unit tests, a frame that cannot start one), in place, where starting a
// worker would cost more. A comparison past MAX_CELLS a side is refused before anything is sent.

import { t } from "../strings/index.js";
import { compareSets, KEEP, MAX_CELLS, tooLarge } from "./diff.js";

/**
 * @typedef {import("./diff.js").Side} Side
 * @typedef {import("./diff.js").Difference} Difference
 * @typedef {import("../explain/reader.js").StartWorker} StartWorker
 */

export const INLINE_MAX = 20_000;

const cellsOf = (/** @type {Side} */ side) => side.rows.length * side.columns.length;
/** Only the columns and rows go to the worker, not what else a result set carries. */
const plain = (/** @type {Side} */ side) => ({ columns: side.columns, rows: side.rows });

/**
 * @param {StartWorker | undefined} startWorker
 * @param {{ inline?: number, max?: number, keep?: number }} [options]
 */
export function createComparer(startWorker, options = {}) {
  const { inline = INLINE_MAX, max = MAX_CELLS, keep = KEEP } = options;
  let next = 0;

  /** The comparison in a worker of its own. @returns {Promise<Difference>} */
  const inWorker = (
    /** @type {StartWorker} */ start,
    /** @type {Side} */ before,
    /** @type {Side} */ after,
    /** @type {string[] | null} */ key,
  ) => {
    const worker = start(new URL("./worker.js", import.meta.url), {
      name: "Database comparison",
    });
    const id = ++next;
    return new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if ("error" in data) reject(new Error(data.error));
        else resolve(data.difference);
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || t("compare.client.theComparisonSWorkerStopped")));
      };
      worker.postMessage({ id, before: plain(before), after: plain(after), key, keep });
    });
  };

  return {
    /**
     * @param {Side} before
     * @param {Side} after
     * @param {string[] | null} key
     * @returns {Promise<Difference>}
     */
    async compare(before, after, key) {
      const refused = tooLarge(before, after, max);
      if (refused) throw new Error(refused);
      const small = cellsOf(before) + cellsOf(after) <= inline;
      if (startWorker && !small) {
        // A frame that cannot start a worker compares in place, as the grid orders its rows.
        const started = (() => {
          try {
            return inWorker(startWorker, before, after, key);
          } catch {
            return undefined;
          }
        })();
        if (started) return started;
      }
      return compareSets(before, after, key, { keep });
    },
  };
}
