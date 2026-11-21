// The list worker, started with the SDK's startWorker (toc-reader.js): the bytes pg_restore --list
// printed in, the archive's header and entries out, so a long list is decoded and read off the
// frame's thread. It imports only relative files: import maps do not reach a module worker.
import { parseToc } from "./toc.js";

/**
 * @typedef {{ id: number, bytes: Uint8Array }} Request
 * @typedef {{ id: number, toc: import("./toc.js").Toc } | { id: number, error: string }} Reply
 */

/** @param {Request} request @returns {Reply} */
export function answer({ id, bytes }) {
  try {
    return { id, toc: parseToc(new TextDecoder("utf-8").decode(bytes)) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
