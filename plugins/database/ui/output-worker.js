// The result worker, started with the SDK's startWorker (output-client.js): a run's output in, as
// bytes or text, its statements' results out, each set already cut to `maxRows` rows. Up to 64 MiB
// is decoded and parsed here, never on the frame's thread (#38). It imports only relative files:
// import maps do not reach a module worker.
import { readOutput } from "./output/index.js";

/**
 * @typedef {import("./engines/common.js").EngineId} EngineId
 * @typedef {import("./engines/common.js").Outcome} Outcome
 * @typedef {import("./engines/common.js").RunResult} RunResult
 * @typedef {Omit<Outcome, "stdout" | "stderr"> & { stdout: string | Uint8Array, stderr: string | Uint8Array }} WireOutcome
 * @typedef {{ id: number, engine: EngineId, outcome: WireOutcome, invocation: import("./output/index.js").Reading, timeoutMs: number }} Request
 * @typedef {{ id: number, result: RunResult } | { id: number, error: string }} Reply
 */

const text = (/** @type {string | Uint8Array} */ value) =>
  typeof value === "string" ? value : new TextDecoder("utf-8").decode(value);

/** @param {Request} request @returns {Reply} */
export function answer({ id, engine, outcome, invocation, timeoutMs }) {
  try {
    const decoded = { ...outcome, stdout: text(outcome.stdout), stderr: text(outcome.stderr) };
    return { id, result: readOutput(engine, decoded, invocation, timeoutMs) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => globalThis.postMessage(answer(event.data));
}
