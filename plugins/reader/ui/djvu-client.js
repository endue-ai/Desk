// DjVu decoding that does not hold up the surface: in a worker (djvu-worker.js, started with the
// SDK's startWorker) that asks this side for the file's byte ranges, so the frame's main thread only
// reads and draws. Where no worker starts (no startWorker, a desk or CSP that refuses one, a library
// the worker cannot import), the decoder runs in the frame, giving the event loop a turn every 25 ms.
import { openDocument } from "./formats/djvu-document.js";

/**
 * @typedef {import("./formats/djvu-document.js").DjvuDocument} DjvuDocument
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * @typedef {(url: string | URL, options?: { name?: string }) => Worker} StartWorker
 */

const STOPPED = "The DjVu decoder stopped.";
const cancelled = (/** @type {AbortSignal | undefined} */ signal) =>
  signal?.reason instanceof Error && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Decoding was cancelled.", "AbortError");

/** A worker that has imported the library, or a rejection. @param {StartWorker} startWorker @param {AbortSignal} [signal] */
function started(startWorker, signal) {
  return /** @type {Promise<Worker>} */ (
    new Promise((resolve, reject) => {
      const worker = startWorker(new URL("./djvu-worker.js", import.meta.url), {
        name: "Reader DjVu",
      });
      const end = (/** @type {unknown} */ error) => {
        worker.removeEventListener("message", ready);
        worker.removeEventListener("error", failed);
        signal?.removeEventListener("abort", abort);
        if (error === undefined) return resolve(worker);
        worker.terminate();
        reject(error);
      };
      const ready = (/** @type {MessageEvent} */ { data }) => {
        if (data?.type === "ready") end(undefined);
        else if (data?.type === "unavailable") end(new Error(data.message));
      };
      const failed = () => end(new Error("The DjVu worker could not start."));
      const abort = () => end(cancelled(signal));
      worker.addEventListener("message", ready);
      worker.addEventListener("error", failed);
      signal?.addEventListener("abort", abort, { once: true });
    })
  );
}

/** @param {Worker} worker @param {Source} source @param {AbortSignal} [signal] @returns {Promise<DjvuDocument>} */
async function inWorker(worker, source, signal) {
  /** @type {Map<number, { resolve(data: any): void, reject(error: unknown): void }>} */
  const pending = new Map();
  let asked = 0;
  let ended = false;
  let crashed = false;
  const end = (/** @type {unknown} */ error) => {
    if (ended) return;
    ended = true;
    worker.terminate();
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  };
  /** @param {Record<string, unknown>} message @param {AbortSignal} [stop] */
  const ask = (message, stop) =>
    new Promise((resolve, reject) => {
      if (ended) return reject(new Error(STOPPED));
      if (stop?.aborted) return reject(cancelled(stop));
      const n = ++asked;
      const abort = () => {
        pending.delete(n);
        worker.postMessage({ type: "cancel", n });
        reject(cancelled(stop));
      };
      pending.set(n, {
        resolve: (data) => {
          stop?.removeEventListener("abort", abort);
          resolve(data);
        },
        reject: (error) => {
          stop?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      stop?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ ...message, n });
    });
  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "read") {
      source.read(data.offset, data.length).then(
        (bytes) => {
          const copy = bytes.slice();
          if (!ended) worker.postMessage({ type: "bytes", n: data.n, bytes: copy }, [copy.buffer]);
        },
        (error) => {
          const name = error?.name ?? "Error";
          if (!ended)
            worker.postMessage({
              type: "bytes",
              n: data.n,
              error: String(error?.message ?? error),
              name,
            });
        },
      );
      return;
    }
    const waiting = pending.get(data?.n);
    if (!waiting) return;
    pending.delete(data.n);
    if (data.type === "failed")
      waiting.reject(Object.assign(new Error(data.message), { name: data.name }));
    else waiting.resolve(data);
  });
  worker.addEventListener("error", () => {
    crashed = true;
    end(new Error(STOPPED));
  });
  const stopOpening = () => end(cancelled(signal));
  signal?.addEventListener("abort", stopOpening, { once: true });
  /** @type {any} */
  let opened;
  try {
    opened = await ask({ type: "open", size: source.size });
  } catch (error) {
    end(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", stopOpening);
  }
  return {
    title: opened.title,
    note: opened.note,
    pages: opened.pages,
    outline: opened.outline ?? [],
    async render(index, { scale, signal: stop }) {
      const { width, height, rgba, bitmap, note } = /** @type {any} */ (
        await ask({ type: "render", index, scale }, stop)
      );
      return { width, height, rgba, bitmap, note };
    },
    text: async (index) => /** @type {any} */ (await ask({ type: "text", index })).value ?? null,
    stopped: () => crashed,
    close: () => end(new DOMException("The document was closed.", "AbortError")),
  };
}

/**
 * Open a DjVu document in a worker when one starts, else in the frame.
 * @param {Source} source
 * @param {{ startWorker?: StartWorker, signal?: AbortSignal }} [options]
 * @returns {Promise<DjvuDocument>}
 */
export async function openDjvuDocument(source, { startWorker, signal } = {}) {
  if (startWorker) {
    /** @type {Worker | undefined} */
    let worker;
    try {
      worker = await started(startWorker, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (worker) return inWorker(worker, source, signal);
  }
  const { openDjvu } = await import("@endue-ai/formats/djvu/index.js");
  signal?.throwIfAborted();
  return openDocument(openDjvu, source);
}
