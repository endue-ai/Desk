// The counting worker, started with the SDK's startWorker (counter.js): a note's text in, its counts
// out. It imports only relative files: import maps do not reach a module worker.
import { countText } from "./count.js";

/** @param {unknown} text @returns {import("./count.js").Counts} */
export const answer = (text) => countText(typeof text === "string" ? text : "");

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
