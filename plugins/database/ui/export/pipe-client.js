// Where a whole export's file is made (PG-64): in the export's worker (pipe-worker.js), one per
// file, its messages answered in order, or in the frame where no worker starts (the unit tests).
// Either way the caller holds one page and its bytes at a time.

import { createPipe } from "./pipe.js";

/**
 * @typedef {import("./pipe.js").PipeJob} PipeJob
 * @typedef {import("./pipe.js").Page} Page
 * @typedef {import("./pipe.js").Out} Out
 * @typedef {{ push(page: Page): Promise<Out[]>, end(): Promise<Out[]>, rows(): number, stop(): void }} RemotePipe
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{ id: number, op: "start", job: PipeJob } | { id: number, op: "push", page: Page } | { id: number, op: "end" }} Message
 */

/** A worker's answer to one message: the bytes made and the rows so far, or what went wrong. */
export async function answerPipe(
  /** @type {{ pipe?: import("./pipe.js").Pipe }} */ held,
  /** @type {Message} */ message,
) {
  try {
    if (message.op === "start") {
      held.pipe = createPipe(message.job);
      return { id: message.id, outs: [], rows: 0 };
    }
    const pipe = held.pipe;
    if (!pipe) throw new Error("Export: the file was not started.");
    const outs = message.op === "push" ? await pipe.push(message.page) : await pipe.end();
    return { id: message.id, outs, rows: pipe.rows() };
  } catch (error) {
    return { id: message.id, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {PipeJob} job
 * @param {StartWorker} [startWorker]
 * @returns {Promise<RemotePipe>}
 */
export async function startPipe(job, startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  try {
    worker = startWorker?.(new URL("./pipe-worker.js", import.meta.url), {
      name: "Export every row",
    });
  } catch {
    worker = undefined;
  }
  if (!worker) {
    const pipe = createPipe(job);
    return { push: pipe.push, end: pipe.end, rows: pipe.rows, stop() {} };
  }
  const w = worker;
  let next = 0;
  let rows = 0;
  /** @type {Map<number, { resolve(v: any): void, reject(e: Error): void }>} */
  const waiting = new Map();
  w.onmessage = ({ data }) => {
    const waiter = waiting.get(data.id);
    waiting.delete(data.id);
    if (!waiter) return;
    if ("error" in data) waiter.reject(new Error(data.error));
    else {
      rows = data.rows;
      waiter.resolve(data.outs);
    }
  };
  w.onerror = () => {
    for (const waiter of waiting.values())
      waiter.reject(new Error("The worker of the export stopped."));
    waiting.clear();
  };
  const ask = (/** @type {Record<string, unknown>} */ message) =>
    /** @type {Promise<Out[]>} */ (
      new Promise((resolve, reject) => {
        const id = ++next;
        waiting.set(id, { resolve, reject });
        w.postMessage({ id, ...message });
      })
    );
  await ask({ op: "start", job });
  return {
    push: (page) => ask({ op: "push", page }),
    end: () => ask({ op: "end" }),
    rows: () => rows,
    stop: () => w.terminate(),
  };
}
