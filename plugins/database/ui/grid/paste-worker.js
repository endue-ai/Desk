// The paste worker (PG-43), started with the SDK's startWorker (paste.js) for text over 16 KiB: it
// reads the text into rows of values (edit/paste-text.js), so a big paste never holds the frame's
// thread. Only relative imports: import maps do not reach a module worker.

import { readPaste } from "../edit/paste-text.js";

/**
 * @typedef {{ id: number, text: string, ours: boolean }} Request
 * @typedef {({ id: number } & import("../edit/paste-text.js").Pasted) | { id: number, error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ id, text, ours }) {
  try {
    return { id, ...readPaste(text, { ours }) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
