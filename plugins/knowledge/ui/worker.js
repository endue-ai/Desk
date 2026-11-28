// The layout worker: lays out one graph per request, off the page's thread. Requests are
// { id, n, edges, weights, mass, start }; answers { id, positions } or { id, error }.

import { layout } from "./layout.js";

/** Answer layout requests on `port` (a worker's global scope, or a MessagePort in tests). */
export function attachLayoutWorker(/** @type {any} */ port) {
  port.onmessage = (/** @type {MessageEvent} */ event) => {
    const { id, ...input } = event.data ?? {};
    try {
      const positions = layout(input);
      port.postMessage({ id, positions }, [positions.buffer]);
    } catch (error) {
      port.postMessage({ id, error: String(error) });
    }
  };
}

if (typeof self !== "undefined" && typeof document === "undefined") attachLayoutWorker(self);
