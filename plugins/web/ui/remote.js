// The main thread's side of the worker (worker.js): one worker per large file, started with the
// SDK's startWorker. The file's bytes move to it, not copied. Its model comes back with resolvers
// that ask the worker for an archive's resources, or read a page's files from disk here; the
// worker stays while such a page is open, and close() ends it. A signal stops the opening.

import { diskResolver } from "./formats.js";
import { holdersOf } from "./worker.js";

/**
 * @typedef {import("./formats.js").Model} Model
 * @typedef {import("./formats.js").Disk} Disk
 * @typedef {import("./formats.js").Resolver} Resolver
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 */

const cancelled = () => new DOMException("Opening was cancelled.", "AbortError");

/** The worker cannot run here (none was started): open the file on the main thread instead. */
export class NoWorker extends Error {}

/**
 * @param {Uint8Array} bytes moved to the worker: unusable here afterwards
 * @param {string} path
 * @param {{ startWorker: StartWorker, disk: Disk, signal?: AbortSignal }} options
 * @returns {Promise<{ model: Model, close(): void }>}
 */
export function openInWorker(bytes, path, { startWorker, disk, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    /** @type {Worker} */
    let worker;
    try {
      worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Web file" });
    } catch (error) {
      return reject(new NoWorker(error instanceof Error ? error.message : String(error)));
    }
    /** Resource loads waiting for the worker, by id. @type {Map<number, (got: Awaited<ReturnType<Resolver["load"]>>) => void>} */
    const pending = new Map();
    let next = 0;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      worker.terminate();
      for (const done of pending.values()) done("missing");
      pending.clear();
    };
    const abort = () => {
      close();
      reject(cancelled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    const settle = () => signal?.removeEventListener("abort", abort);

    /** A resolver that asks the worker for an archive's resources. @param {number} id */
    const remote = (id) => (/** @type {string} */ url) =>
      new Promise((done) => {
        if (closed) return done("missing");
        const n = ++next;
        pending.set(n, done);
        worker.postMessage({ type: "load", id: n, resolver: id, url });
      });
    /** @param {Model} model */
    const unpack = (model) => {
      let remotes = 0;
      for (const holder of holdersOf(model)) {
        const page = holder.page;
        if (!page) continue;
        const packed = /** @type {{ base: string, local?: string, remote?: number }} */ (
          /** @type {unknown} */ (page.resolver)
        );
        /** @type {Resolver} */
        let resolver;
        if (packed.local !== undefined) resolver = diskResolver(packed.local, disk);
        else {
          remotes++;
          resolver = {
            base: packed.base,
            load: /** @type {Resolver["load"]} */ (remote(packed.remote ?? 0)),
          };
        }
        holder.page = { ...page, resolver };
        if (holder.sameSource) {
          holder.source = page.text;
          delete holder.sameSource;
        }
      }
      // Nothing left to ask the worker: let it go now.
      if (remotes === 0) close();
      return model;
    };

    worker.onmessage = (/** @type {MessageEvent} */ { data }) => {
      if (closed) return;
      if (data.type === "loaded") {
        pending.get(data.id)?.(data.got);
        pending.delete(data.id);
        return;
      }
      settle();
      if (data.type === "opened") resolve({ model: unpack(data.model), close });
      else {
        close();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (/** @type {ErrorEvent} */ event) => {
      settle();
      close();
      reject(new Error(event?.message || "The worker stopped."));
    };
    worker.postMessage({ type: "open", bytes, path }, [bytes.buffer]);
  });
}
