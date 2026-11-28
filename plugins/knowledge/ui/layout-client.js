// Lays graphs out in a worker when the page can start one (the SDK's startWorker), on the page's
// thread otherwise. Only the latest request is answered: a newer one supersedes it.

import { layout } from "./layout.js";

/**
 * @typedef {import("./layout.js").LayoutInput} LayoutInput
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 */

/** @param {StartWorker | undefined} startWorker */
export function createLayouts(startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  try {
    worker = startWorker?.(new URL("./worker.js", import.meta.url), { name: "Knowledge layout" });
  } catch {
    worker = undefined;
  }
  let latest = 0;
  /** @type {Map<number, (value: Float32Array | undefined) => void>} */
  const waiting = new Map();
  if (worker)
    worker.onmessage = (/** @type {MessageEvent} */ event) => {
      const { id, positions } = event.data ?? {};
      const resolve = waiting.get(id);
      waiting.delete(id);
      resolve?.(id === latest ? positions : undefined);
    };
  return {
    /**
     * Positions for the graph, or undefined when a newer request came first.
     * @param {LayoutInput} input
     * @returns {Promise<Float32Array | undefined>}
     */
    run(input) {
      const id = ++latest;
      if (!worker) return Promise.resolve(layout(input));
      for (const resolve of waiting.values()) resolve(undefined);
      waiting.clear();
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker?.postMessage({ id, ...input });
      });
    },
    stop() {
      worker?.terminate();
      for (const resolve of waiting.values()) resolve(undefined);
      waiting.clear();
    },
  };
}
