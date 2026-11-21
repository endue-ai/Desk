// The diagram's layout worker, started with the SDK's startWorker (layout-client.js): a problem in
// (the boxes' sizes, the links, the kept positions), every position and route out, so a diagram of
// hundreds of tables is laid out off the frame's thread. It imports only relative files: import
// maps do not reach a module worker.
import { solve } from "./layout.js";

/**
 * @typedef {{ id: number, problem: import("./layout.js").Problem }} Request
 * @typedef {{ id: number, solution: import("./layout.js").Solution } | { id: number, error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ id, problem }) {
  try {
    return { id, solution: solve(problem) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
