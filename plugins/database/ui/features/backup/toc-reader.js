// The list reader: what pg_restore --list printed is read in the list worker (toc-worker.js) when
// it is 64 KiB or more, in place when smaller, where starting a worker costs more than the reading.
// The worker goes when its list is read: a restore reads one list.

import { t } from "../../strings/index.js";
import { parseToc } from "./toc.js";

/**
 * @typedef {import("../../explain/reader.js").StartWorker} StartWorker
 * @typedef {import("./toc.js").Toc} Toc
 */

/** Lists with fewer bytes than this are read in place. */
export const INLINE_MAX = 64 * 1024;

/**
 * Read a list from its bytes.
 * @param {Uint8Array} bytes
 * @param {StartWorker} [startWorker] Without one, every list is read in place (tests).
 * @returns {Promise<Toc>}
 */
export function readToc(bytes, startWorker) {
  if (!startWorker || bytes.length < INLINE_MAX)
    return Promise.resolve(parseToc(new TextDecoder("utf-8").decode(bytes)));
  const worker = startWorker(new URL("./toc-worker.js", import.meta.url), {
    name: "Database archive list",
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.toc);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || t("features.backup.tocReader.theListReaderStopped")));
    };
    worker.postMessage({ id: 1, bytes });
  });
}
