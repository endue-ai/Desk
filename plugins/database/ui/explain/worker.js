// The plan worker, started with the SDK's startWorker (reader.js): a result set that holds a plan
// in, the plan tree out, so a big JSON plan is parsed and walked off the frame's thread. It imports
// only relative files: import maps do not reach a module worker.
import { planOf } from "./plan.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {{ id: number, set: ResultSet }} Request
 * @typedef {{ id: number, plan: import("./node.js").PlanNode | null } | { id: number, error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ id, set }) {
  try {
    return { id, plan: planOf(set) ?? null };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
