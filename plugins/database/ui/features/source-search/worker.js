// The source search's worker, started with the SDK's startWorker (matcher.js): the definitions of a
// step and the query in, each one's matching lines out, so a big text is searched off the frame's
// thread. It imports only relative files: import maps do not reach a module worker.
import { matchTexts } from "./match.js";

/**
 * @typedef {{ id: number, texts: string[], query: import("./match.js").Query, skips: [number, number][][] }} Request
 * @typedef {{ id: number, found: (import("./match.js").Found | null)[] } | { id: number, error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ id, texts, query, skips }) {
  try {
    return { id, found: matchTexts(texts, query, skips) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
