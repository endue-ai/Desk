// The frame's side of the library worker (library-worker.js): it starts the worker with the SDK's
// startWorker, answers its byte-range reads from the file's source, and asks it for work. A worker
// that does not start, or cannot load endue.formats, leaves the decoding to the frame (the callers'
// fallback); one that stops later fails what it was asked with a sentence.

/**
 * @typedef {(url: string | URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * @typedef {{ signal?: AbortSignal, entry?: (data: any) => Promise<unknown> }} AskOptions
 * @typedef {{ ask(message: Record<string, unknown>, options?: AskOptions): Promise<any>,
 *   stopped(): boolean, close(): void }} Link
 */

export const STOPPED = "The decoder stopped.";

export const cancelled = (/** @type {AbortSignal | undefined} */ signal) =>
  signal?.reason instanceof Error && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Decoding was cancelled.", "AbortError");

/** Whether an error says the worker could not load the library (the frame then decodes). */
export const unavailable = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "LibraryUnavailable";

/** A started worker, or undefined when none starts. @param {StartWorker | undefined} startWorker @param {AbortSignal} [signal] */
export async function startLibraryWorker(startWorker, signal) {
  if (!startWorker) return undefined;
  try {
    return await /** @type {Promise<Worker>} */ (
      new Promise((resolve, reject) => {
        const worker = startWorker(new URL("./library-worker.js", import.meta.url), {
          name: "Reader decoder",
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
        };
        const failed = () => end(new Error("The decoder worker could not start."));
        const abort = () => end(cancelled(signal));
        worker.addEventListener("message", ready);
        worker.addEventListener("error", failed);
        signal?.addEventListener("abort", abort, { once: true });
      })
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

/** @param {Worker} worker @param {Source} source @returns {Link} */
export function connect(worker, source) {
  /** @type {Map<number, { resolve(data: any): void, reject(error: unknown): void, entry?: AskOptions["entry"] }>} */
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
  const reply = (/** @type {any} */ message, /** @type {Transferable[]} */ transfer = []) => {
    if (!ended) worker.postMessage(message, transfer);
  };
  const failure = (/** @type {any} */ error) => ({
    error: String(error?.message ?? error),
    name: error?.name ?? "Error",
  });
  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "read") {
      source.read(data.offset, data.length).then(
        (bytes) => {
          const copy = bytes.slice();
          reply({ type: "bytes", n: data.n, bytes: copy }, [copy.buffer]);
        },
        (error) => reply({ type: "bytes", n: data.n, ...failure(error) }),
      );
      return;
    }
    const waiting = pending.get(data?.n);
    if (!waiting) return;
    if (data.type === "entry") {
      const visit = waiting.entry?.(data) ?? Promise.resolve();
      Promise.resolve(visit).then(
        () => reply({ type: "visited", n: data.n, index: data.index }),
        (error) => reply({ type: "visited", n: data.n, index: data.index, ...failure(error) }),
      );
      return;
    }
    pending.delete(data.n);
    if (data.type === "failed")
      waiting.reject(Object.assign(new Error(data.message), { name: data.name }));
    else waiting.resolve(data);
  });
  worker.addEventListener("error", () => {
    crashed = true;
    end(new Error(STOPPED));
  });
  return {
    ask: (message, { signal, entry } = {}) =>
      new Promise((resolve, reject) => {
        if (ended) return reject(new Error(STOPPED));
        if (signal?.aborted) return reject(cancelled(signal));
        const n = ++asked;
        const abort = () => {
          pending.delete(n);
          reply({ type: "cancel", n });
          reject(cancelled(signal));
        };
        const done = () => signal?.removeEventListener("abort", abort);
        pending.set(n, {
          resolve: (data) => {
            done();
            resolve(data);
          },
          reject: (error) => {
            done();
            reject(error);
          },
          entry,
        });
        signal?.addEventListener("abort", abort, { once: true });
        reply({ ...message, n });
      }),
    stopped: () => crashed,
    close: () => end(new DOMException("The file was closed.", "AbortError")),
  };
}
