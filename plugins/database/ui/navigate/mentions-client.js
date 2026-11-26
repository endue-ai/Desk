// Where routine bodies name an aim (PG-32): in the worker (mentions-worker.js) past INLINE_MAX
// characters in all, in place below, so a handful of small bodies costs no worker.

import { t as messageText } from "../strings/index.js";
import { mentionsOf } from "./mentions.js";

/**
 * @typedef {import("./target.js").Aim} Aim
 * @typedef {import("../explain/reader.js").StartWorker} StartWorker
 * @typedef {ReturnType<typeof mentionsOf>} Found
 */

/** Bodies with fewer characters than this in all are scanned in place. */
export const INLINE_MAX = 64 * 1024;

/**
 * @param {string[]} texts
 * @param {Aim} aim
 * @param {StartWorker} [startWorker] absent in tests
 * @returns {Promise<Found[]>}
 */
export function scanBodies(texts, aim, startWorker) {
  const size = texts.reduce((n, t) => n + t.length, 0);
  if (!startWorker || size < INLINE_MAX)
    return Promise.resolve(texts.map((t) => mentionsOf(t, aim)));
  const worker = startWorker(new URL("./mentions-worker.js", import.meta.url), {
    name: "Database usages",
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.found);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(
        new Error(
          event.message || messageText("navigate.mentionsClient.theScanOfTheRoutineBodies"),
        ),
      );
    };
    worker.postMessage({ texts, aim });
  });
}
