// What the import's worker answers (PG-60), and the frame the same without one (client.js): a
// sample's records, a transform opened on a job, and one turn of it (feed the next piece, take what
// is ready). A failure answers its sentence. Pure.

import { sampleOf } from "./sample.js";
import { base64Bytes, createTransform, exchange } from "./transform.js";

/**
 * @typedef {import("./transform.js").Job} Job
 * @typedef {import("./transform.js").XlsxReader} XlsxReader
 * @typedef {{ id: number, sample?: { options: import("./sample.js").ReadOptions, data: string, whole: boolean },
 *   job?: Job, turn?: { feed?: string | null, maxBytes: number, maxRows?: number } }} Request
 */

/**
 * @param {{ transform?: ReturnType<typeof createTransform> }} held
 * @param {Request} request
 * @param {{ xlsx?: XlsxReader }} readers
 */
export function answer(held, request, readers) {
  const { id } = request;
  try {
    if (request.sample) {
      const { options, data, whole } = request.sample;
      return { id, sample: sampleOf(options, base64Bytes(data), whole, readers) };
    }
    if (request.job) {
      held.transform = createTransform(request.job, readers);
      return { id, ok: true };
    }
    if (request.turn && held.transform) return { id, ...exchange(held.transform, request.turn) };
    return { id, error: "No file is open to read." };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}
