// Where an export's file is written (PG-61): in the frame up to 20,000 cells, else in the export's
// worker (worker.js), started for that one file and ended after it. Without a worker (the unit
// tests, a frame that cannot start one) the same code writes it in the frame.

import { cellsOf, exportFile } from "./file.js";

/**
 * @typedef {import("./file.js").Job} Job
 * @typedef {import("./file.js").Written} Written
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 */

export const LARGE = 20_000;

/**
 * @param {Job} job
 * @param {StartWorker} [startWorker]
 * @param {number} [threshold] Cells past which the worker writes.
 * @returns {Promise<Written>}
 */
export async function writeFile(job, startWorker, threshold = LARGE) {
  if (!startWorker || cellsOf(job) <= threshold) return exportFile(job);
  /** @type {Worker} */
  let worker;
  try {
    worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Database export" });
  } catch {
    return exportFile(job);
  }
  try {
    const reply = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = () => reject(new Error("The export's worker stopped."));
      worker.postMessage({ id: 1, job });
    });
    if ("error" in reply) throw new Error(reply.error);
    const { id: _, ...written } = reply;
    return written;
  } finally {
    worker.terminate();
  }
}
