// The comparison's worker, started with the SDK's startWorker (client.js): two results and a key
// in, their difference out (diff.js), so pairing two large results never holds the frame's thread.
// Its answer is bounded: the counts, and the first differences with their values. Only relative
// imports: import maps do not reach a module worker.
import { compareSets } from "./diff.js";

/**
 * @typedef {import("./diff.js").Side} Side
 * @typedef {{ id: number, before: Side, after: Side, key: string[] | null, keep: number }} Request
 * @typedef {{ id: number, difference: import("./diff.js").Difference } | { id: number, error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ id, before, after, key, keep }) {
  try {
    return { id, difference: compareSets(before, after, key, { keep }) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
