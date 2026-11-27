// The comparison's worker, started with the SDK's startWorker (client.js): two models in, the
// comparison out, with how far it is along every 500 objects, so tens of thousands of objects are
// compared off the frame's thread. It imports only relative files: import maps do not reach a module
// worker.
import { compareModels } from "./diff.js";

/**
 * @typedef {{ left: import("./model.js").Model, right: import("./model.js").Model }} Request
 * @typedef {{ tick: [number, number] } | { done: import("./diff.js").Comparison } | { error: string }} Reply
 */

/** @param {Request} request @param {(reply: Reply) => void} post */
export function answer({ left, right }, post) {
  try {
    post({
      done: compareModels(left, right, { tick: (done, total) => post({ tick: [done, total] }) }),
    });
  } catch (error) {
    post({ error: error instanceof Error ? error.message : String(error) });
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => answer(event.data, (reply) => globalThis.postMessage(reply));
}
