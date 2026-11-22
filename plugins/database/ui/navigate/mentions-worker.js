// The body scan's worker, started with the SDK's startWorker (mentions-client.js): routine bodies and
// an aim in, where each names it out, so a schema of large PL/pgSQL bodies is read off the frame's
// thread. It imports only relative files: import maps do not reach a module worker.
import { mentionsOf } from "./mentions.js";

/**
 * @typedef {{ texts: string[], aim: import("./target.js").Aim }} Request
 * @typedef {{ found: ReturnType<typeof mentionsOf>[] } | { error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ texts, aim }) {
  try {
    return { found: texts.map((t) => mentionsOf(t, aim)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
