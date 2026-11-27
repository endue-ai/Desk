// Where an import reads its file (PG-60): in the import's worker (worker.js), started for one file
// and ended after it, so parsing gigabytes never holds the frame; without one (the unit tests) the
// same code answers in place, an `.xlsx` only with the reader the caller gives. One request at a
// time, in order.

import { t } from "../strings/index.js";
import { answer } from "./answer.js";

/**
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {import("./answer.js").Request} Request
 * @typedef {import("./transform.js").XlsxReader} XlsxReader
 * @typedef {{ text: string, rows: number, bytes: number, ready: boolean, ended: boolean }} Turn
 * @typedef {{
 *   sample(options: import("./sample.js").ReadOptions, data: string, whole: boolean): Promise<import("./sample.js").Sample>,
 *   open(job: import("./transform.js").Job): Promise<void>,
 *   turn(turn: NonNullable<Request["turn"]>): Promise<Turn>,
 *   close(): void,
 * }} Reader
 */

/**
 * @param {{ startWorker?: StartWorker, xlsx?: XlsxReader }} [options]
 * @returns {Reader}
 */
export function createReader(options = {}) {
  /** @type {Worker | undefined} */
  let worker;
  let ids = 0;
  /** @type {Map<number, (reply: any) => void>} */
  const waiting = new Map();
  const held = {};
  const start = () => {
    if (worker || !options.startWorker) return worker;
    try {
      worker = options.startWorker(new URL("./worker.js", import.meta.url), {
        name: "Database import",
      });
    } catch {
      return undefined;
    }
    worker.onmessage = ({ data }) => {
      waiting.get(data.id)?.(data);
      waiting.delete(data.id);
    };
    worker.onerror = () => {
      for (const done of waiting.values())
        done({ error: t("importCopy.client.theWorkerReadingTheFileStopped") });
      waiting.clear();
    };
    return worker;
  };
  /** @param {Omit<Request, "id">} request */
  const ask = async (request) => {
    const id = ++ids;
    const on = start();
    const reply = on
      ? await new Promise((resolve) => {
          waiting.set(id, resolve);
          on.postMessage({ id, ...request });
        })
      : answer(held, { id, ...request }, options.xlsx ? { xlsx: options.xlsx } : {});
    if ("error" in reply) throw new Error(reply.error);
    return reply;
  };
  return {
    sample: async (opts, data, whole) =>
      (await ask({ sample: { options: opts, data, whole } })).sample,
    open: async (job) => {
      await ask({ job });
    },
    turn: async (turn) => {
      const { id: _, ...rest } = await ask({ turn });
      return rest;
    },
    close() {
      worker?.terminate();
      worker = undefined;
    },
  };
}
