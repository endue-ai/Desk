// Where a diagram is laid out (PG-55): in the frame up to WORKER_FROM tables, else in the layout
// worker (layout-worker.js), started with the SDK's startWorker the first time a large diagram needs
// it and kept for the next. ui/main.js provides the starter (`provideLayoutWorker`); without one (the
// unit tests, a frame that cannot start a worker) every layout runs in the frame.
import { solve } from "./layout.js";

/**
 * @typedef {import("./layout.js").Problem} Problem
 * @typedef {import("./layout.js").Solution} Solution
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 */

export const WORKER_FROM = 200;

/** @type {StartWorker | undefined} */
let starter;
/** @type {Worker | undefined} */
let worker;
let next = 0;
/** @type {Map<number, { resolve(s: Solution): void, reject(e: unknown): void }>} */
const pending = new Map();

/** Let large diagrams be laid out in a worker the SDK starts (ui/main.js). */
export function provideLayoutWorker(/** @type {StartWorker | undefined} */ start) {
  worker?.terminate();
  worker = undefined;
  starter = start;
}

const stop = (/** @type {unknown} */ error) => {
  worker?.terminate();
  worker = undefined;
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
};

const started = () => {
  if (worker || !starter) return worker;
  try {
    worker = starter(new URL("./layout-worker.js", import.meta.url), { name: "Database diagram" });
  } catch {
    return undefined;
  }
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if ("error" in data) entry.reject(new Error(data.error));
    else entry.resolve(data.solution);
  };
  worker.onerror = (event) => stop(new Error(event.message || "The diagram's layout stopped."));
  return worker;
};

/** Lay a problem out: in the worker past WORKER_FROM tables when there is one, else here. */
export async function laidOut(/** @type {Problem} */ problem) {
  const target = problem.nodes.length > WORKER_FROM ? started() : undefined;
  if (!target) return solve(problem);
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, problem });
  });
}
