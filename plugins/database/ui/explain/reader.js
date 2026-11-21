// The plan reader: a plan of 64 KiB of text or more is read in the plan worker (worker.js), a
// smaller one in place, where starting a worker would cost more than the reading. One worker serves
// every plan; when it fails, what was in flight fails with it and the next big plan starts another.
import { planOf } from "./plan.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{ read(set: ResultSet): Promise<PlanNode | undefined> }} PlanReader
 */

/** Plans with less text than this are read in place. */
export const INLINE_MAX = 64 * 1024;

const sizeOf = (/** @type {ResultSet} */ set) =>
  set.rows.reduce((sum, row) => sum + (row[0]?.length ?? 0), 0);

/** @param {StartWorker} [startWorker] Without one, every plan is read in place (tests). @returns {PlanReader} */
export function createPlanReader(startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  /** @type {Map<number, { resolve(plan: PlanNode | undefined): void, reject(error: unknown): void }>} */
  const pending = new Map();

  const stop = (/** @type {unknown} */ error) => {
    worker?.terminate();
    worker = undefined;
    const failed = [...pending.values()];
    pending.clear();
    for (const entry of failed) entry.reject(error);
  };
  const started = (/** @type {StartWorker} */ start) => {
    if (worker) return worker;
    const fresh = start(new URL("./worker.js", import.meta.url), { name: "Database plans" });
    fresh.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if ("error" in data) entry.reject(new Error(data.error));
      else entry.resolve(data.plan ?? undefined);
    };
    fresh.onerror = (event) => stop(new Error(event.message || "The plan reader stopped."));
    worker = fresh;
    return fresh;
  };

  return {
    async read(set) {
      if (!startWorker || sizeOf(set) < INLINE_MAX) return planOf(set);
      const id = ++next;
      const { columns, rows, truncated } = set;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        started(startWorker).postMessage({ id, set: { columns, rows, truncated } });
      });
    },
  };
}
