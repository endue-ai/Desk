// The result reader: a run's output goes to a worker (output-worker.js) that reads it into result
// sets, so up to 64 MiB of client output is decoded and parsed off the frame's thread (#38, ADR
// 0048). One worker serves every run. Cancel stops it (a parse cannot be interrupted otherwise):
// every read in flight is cancelled and the next read starts a fresh worker.
import { outputBytes } from "./run.js";

/**
 * @typedef {import("./engines/common.js").EngineId} EngineId
 * @typedef {import("./engines/common.js").Outcome} Outcome
 * @typedef {import("./engines/common.js").Invocation} Invocation
 * @typedef {import("./engines/common.js").RunResult} RunResult
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{
 *   read(engine: EngineId, outcome: Outcome, invocation: Invocation, timeoutMs: number): Promise<RunResult>,
 *   cancel(): void,
 * }} OutputReader
 */

export const cancelledRead = () =>
  new DOMException("Reading the results was cancelled.", "AbortError");

/**
 * What crosses to the worker: the outcome's flags, its output as the runner's bytes when it has them
 * (never decoded here) or as text, and the three things of the plan a reader needs.
 * @param {EngineId} engine @param {Outcome} outcome @param {Invocation} invocation
 * @param {number} timeoutMs @param {number} id
 */
function request(engine, outcome, invocation, timeoutMs, id) {
  const bytes = outputBytes(outcome);
  const { code, signal, stopped, cancelled, timedOut, overflow, ms } = outcome;
  const { statements, nonce, maxRows } = invocation;
  return {
    id,
    engine,
    outcome: {
      code,
      signal,
      stopped,
      cancelled,
      timedOut,
      overflow,
      ms,
      stdout: bytes?.stdout ?? outcome.stdout,
      stderr: bytes?.stderr ?? outcome.stderr,
    },
    invocation: { statements, nonce, maxRows },
    timeoutMs,
  };
}

/**
 * @param {StartWorker} startWorker
 * @param {{ onBusy?(reading: number): void }} [options] how many reads are in flight
 * @returns {OutputReader}
 */
export function createOutputReader(startWorker, options = {}) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  /** @type {Map<number, { resolve(result: RunResult): void, reject(error: unknown): void }>} */
  const pending = new Map();
  const busy = () => options.onBusy?.(pending.size);

  const stop = (/** @type {unknown} */ error) => {
    worker?.terminate();
    worker = undefined;
    const failed = [...pending.values()];
    pending.clear();
    for (const entry of failed) entry.reject(error);
    busy();
  };
  const started = () => {
    if (worker) return worker;
    const fresh = startWorker(new URL("./output-worker.js", import.meta.url), {
      name: "Database results",
    });
    fresh.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      busy();
      if ("error" in data) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    fresh.onerror = (event) => stop(new Error(event.message || "The result reader stopped."));
    worker = fresh;
    return fresh;
  };

  return {
    read(engine, outcome, invocation, timeoutMs) {
      const id = ++next;
      const message = request(engine, outcome, invocation, timeoutMs, id);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        busy();
        started().postMessage(message);
      });
    },
    cancel: () => {
      if (pending.size > 0) stop(cancelledRead());
    },
  };
}
