// The frame's side of the library worker (library-worker.js): it starts the worker with the SDK's
// startWorker, answers its byte-range reads from the archive's source, and stands for the archive
// it opened, so the plugin reads entries as from any format. A worker that does not start, or
// cannot load endue.formats, leaves the archive to the frame (opening.js); one that stops later
// fails what it was asked with a sentence.

/**
 * @typedef {(url: string | URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {import("./source.js").Source} Source
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Entry} Entry
 * @typedef {import("./formats/archive.js").Job} Job
 * @typedef {{ signal?: AbortSignal, progress?: (done: number, total: number) => void,
 *   entry?: (data: any) => Promise<unknown> }} AskOptions
 * @typedef {{ ask(message: Record<string, unknown>, options?: AskOptions): Promise<any>, close(): void }} Link
 */

export const STOPPED = "The library worker stopped.";

const cancelled = (/** @type {AbortSignal | undefined} */ signal) =>
  signal?.reason instanceof Error && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("The work was cancelled.", "AbortError");

/** Whether an error says the worker could not load the library (the frame then opens it). */
export const unavailable = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "LibraryUnavailable";

/** A started worker, or undefined when none starts. @param {StartWorker | undefined} startWorker */
export async function startLibraryWorker(startWorker) {
  if (!startWorker) return undefined;
  try {
    return await /** @type {Promise<Worker>} */ (
      new Promise((resolve, reject) => {
        const worker = startWorker(new URL("./library-worker.js", import.meta.url), {
          name: "Archives decoder",
        });
        const end = (/** @type {Error | undefined} */ error) => {
          worker.removeEventListener("message", ready);
          worker.removeEventListener("error", failed);
          if (!error) return resolve(worker);
          worker.terminate();
          reject(error);
        };
        const ready = (/** @type {MessageEvent} */ { data }) => {
          if (data?.type === "ready") end(undefined);
        };
        const failed = () => end(new Error("The library worker could not start."));
        worker.addEventListener("message", ready);
        worker.addEventListener("error", failed);
      })
    );
  } catch {
    return undefined;
  }
}

/** @param {Worker} worker @param {Source} source @returns {Link} */
export function connect(worker, source) {
  /** @type {Map<number, { resolve(data: any): void, reject(error: unknown): void } & AskOptions>} */
  const pending = new Map();
  let asked = 0;
  let ended = false;
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
    if (data.type === "progress") return waiting.progress?.(data.done, data.total);
    if (data.type === "entry") {
      Promise.resolve(waiting.entry?.(data)).then(
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
  worker.addEventListener("error", () => end(new Error(STOPPED)));
  return {
    ask: (message, options = {}) =>
      new Promise((resolve, reject) => {
        const { signal } = options;
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
          ...options,
          resolve: (data) => {
            done();
            resolve(data);
          },
          reject: (error) => {
            done();
            reject(error);
          },
        });
        signal?.addEventListener("abort", abort, { once: true });
        reply({ ...message, n });
      }),
    close: () => end(new DOMException("The archive was closed.", "AbortError")),
  };
}

/**
 * Open `source` in the worker: the archive it answers, whose reads go to the worker.
 * @param {Link} link @param {Source} source @param {{ key: string, label: string }} kind @param {Job} [job]
 * @returns {Promise<Archive>}
 */
export async function openRemote(link, source, kind, job = {}) {
  const ask = (
    /** @type {Record<string, unknown>} */ message,
    /** @type {Job} */ { signal, report } = {},
    /** @type {AskOptions["entry"]} */ entry,
  ) => link.ask(message, { signal, progress: report, entry });
  const opened = await ask({ type: "open", kind, size: source.size }, job);
  /** @type {Entry[]} */
  const entries = opened.entries;
  const at = new Map(entries.map((entry, i) => [entry, i]));
  /** @type {Archive} */
  const archive = {
    format: opened.format,
    entries,
    details: opened.details,
    read: async (entry, limit = Number.POSITIVE_INFINITY, job = {}) =>
      (await ask({ type: "entry", index: at.get(entry), limit }, job)).bytes,
    close: () => link.close(),
  };
  if (opened.note) archive.note = opened.note;
  if (opened.refusal) archive.refusal = opened.refusal;
  if (opened.each)
    archive.each = async (wanted, visit, job = {}) => {
      // What the visitor threw (a stop between files) is thrown as it is, not as the worker's copy.
      // A cancel ends the worker's pass at once; the entry being written is waited for.
      /** @type {{ error: unknown } | undefined} */
      let threw;
      let visiting = Promise.resolve();
      const entry = (/** @type {any} */ data) => {
        const run = Promise.resolve(
          visit(/** @type {Entry} */ (entries[data.index]), data.bytes),
        ).catch((error) => {
          threw ??= { error };
          throw error;
        });
        visiting = run.then(
          () => {},
          () => {},
        );
        return run;
      };
      try {
        await ask({ type: "each", indices: wanted.map((e) => at.get(e)) }, job, entry);
      } catch (error) {
        await visiting;
        throw threw ? threw.error : error;
      }
    };
  return archive;
}
