// Where two models are compared (PG-53): in the worker (worker.js) past INLINE_MAX objects, in place
// below it, a slice at a time so the frame keeps drawing. Either way it says how far it is along and
// stops on Cancel (the signal): the worker is ended, the slices stop.
import { itemOf, keysOf } from "./diff.js";
import { keyOf } from "./model.js";

/**
 * @typedef {import("./model.js").Model} Model
 * @typedef {import("./diff.js").Comparison} Comparison
 * @typedef {import("../../explain/reader.js").StartWorker} StartWorker
 */

/** Models with fewer objects than this are compared in place. */
export const INLINE_MAX = 2_000;
const SLICE = 500;
const stopped = () => Object.assign(new Error("Not compared."), { code: "cancelled" });

/**
 * @param {Model} left
 * @param {Model} right
 * @param {{ startWorker?: StartWorker, signal?: AbortSignal, tick?(done: number, total: number): void }} [how]
 * @returns {Promise<Comparison>}
 */
export function compareIn(left, right, { startWorker, signal, tick } = {}) {
  if (startWorker && left.objects.length + right.objects.length >= INLINE_MAX) {
    const worker = startWorker(new URL("./worker.js", import.meta.url), {
      name: "Database schema compare",
    });
    return new Promise((resolve, reject) => {
      const end = () => {
        worker.terminate();
        reject(stopped());
      };
      signal?.addEventListener("abort", end, { once: true });
      worker.onmessage = ({ data }) => {
        if ("tick" in data) return tick?.(...data.tick);
        signal?.removeEventListener("abort", end);
        worker.terminate();
        if ("error" in data) reject(new Error(data.error));
        else resolve(data.done);
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || "The comparison stopped."));
      };
      worker.postMessage({ left, right });
    });
  }
  return inPlace(left, right, signal, tick);
}

async function inPlace(
  /** @type {Model} */ left,
  /** @type {Model} */ right,
  /** @type {AbortSignal | undefined} */ signal,
  /** @type {((done: number, total: number) => void) | undefined} */ tick,
) {
  const l = new Map(left.objects.map((o) => [keyOf(o), o]));
  const r = new Map(right.objects.map((o) => [keyOf(o), o]));
  const keys = keysOf(left, right);
  const schemas = { left: left.schema, right: right.schema };
  /** @type {Comparison["items"]} */
  const items = [];
  let same = 0;
  for (let i = 0; i < keys.length; i += SLICE) {
    if (signal?.aborted) throw stopped();
    for (const key of keys.slice(i, i + SLICE)) {
      const item = itemOf(key, l.get(key), r.get(key), schemas);
      if (item) items.push(item);
      else same++;
    }
    tick?.(Math.min(i + SLICE, keys.length), keys.length);
    if (i + SLICE < keys.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { items, same, left: left.objects.length, right: right.objects.length };
}
