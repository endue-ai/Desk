// The library worker: endue.formats' RAR, disk, Apple and pack readers off the frame's main thread,
// one worker per archive opened with them, started with the SDK's startWorker (library-client.js).
// It asks the frame for byte ranges and answers the archive's listing, an entry's bytes (its first
// `limit`), and several entries in one pass, each handed over before the next is read. A decode
// reports how far it is and stops when the frame cancels it. Import maps do not reach workers, so
// the library is imported by its URL: the desk serves endue.formats at /endue.formats/ on the
// plugin's own scheme.
import { described, LIBRARY, openLibrary } from "./formats/library.js";

/** The URL of a library folder's index on the scheme `base` is on. @param {string} folder @param {string | URL} base */
export const libraryUrl = (folder, base) =>
  new URL(`/endue.formats/lib/${folder}/index.js`, base).href;

/**
 * What the worker does with each message; the tests run it on their own thread.
 * @param {(data: any, transfer?: Transferable[]) => void} post
 * @param {(folder: string) => Promise<any>} load the library folder's index module
 */
export function createLibraryHandler(post, load) {
  /** Reads and handed-over entries waiting for the frame. @type {Map<string, { resolve(value: any): void, reject(error: unknown): void }>} */
  const waiting = new Map();
  /** @type {Map<number, AbortController>} */
  const jobs = new Map();
  let asked = 0;
  /** @type {import("./formats/archive.js").Archive | undefined} */
  let archive;
  const wait = (/** @type {string} */ key) =>
    new Promise((resolve, reject) => waiting.set(key, { resolve, reject }));
  const settle = (
    /** @type {string} */ key,
    /** @type {any} */ message,
    /** @type {unknown} */ value,
  ) => {
    const found = waiting.get(key);
    waiting.delete(key);
    if (message.error === undefined) found?.resolve(value);
    else found?.reject(Object.assign(new Error(message.error), { name: message.name }));
  };
  const source = (/** @type {number} */ size) => ({
    size,
    read: (/** @type {number} */ offset, /** @type {number} */ length) => {
      const n = ++asked;
      post({ type: "read", n, offset, length });
      return /** @type {Promise<Uint8Array>} */ (wait(`read:${n}`));
    },
  });
  /** Bytes the frame may take: a copy when they share a larger buffer. @param {Uint8Array} bytes */
  const own = (bytes) =>
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  /** A job's signal and progress, reported to the frame ten times a second at most. @param {number} n @param {AbortSignal} signal */
  const job = (n, signal) => {
    let last = 0;
    return {
      signal,
      report: (/** @type {number} */ done, /** @type {number} */ total) => {
        const now = Date.now();
        if (now - last < 100) return;
        last = now;
        post({ type: "progress", n, done, total });
      },
    };
  };
  const opened = () => {
    if (!archive) throw new Error("No archive is open in the worker.");
    return archive;
  };
  const ops = /** @type {Record<string, (message: any, signal: AbortSignal) => Promise<void>>} */ ({
    async open({ n, kind, size }, signal) {
      const folder = LIBRARY[kind.key];
      let lib;
      try {
        lib = await load(folder ?? "missing");
      } catch (error) {
        throw Object.assign(new Error(`endue.formats could not be loaded: ${error}`), {
          name: "LibraryUnavailable",
        });
      }
      archive = await openLibrary(lib, kind, source(size), job(n, signal));
      post({ type: "answer", n, ...described(archive), each: !!archive.each });
    },
    async entry({ n, index, limit }, signal) {
      const at = opened();
      const bytes = own(await at.read(at.entries[index], limit, job(n, signal)));
      post({ type: "answer", n, bytes }, [bytes.buffer]);
    },
    async each({ n, indices }, signal) {
      const at = opened();
      const index = new Map(at.entries.map((entry, i) => [entry, i]));
      if (!at.each) throw new Error("This archive reads its entries one at a time.");
      await at.each(
        indices.map((/** @type {number} */ i) => at.entries[i]),
        async (entry, raw) => {
          const bytes = raw.slice();
          const i = index.get(entry);
          post({ type: "entry", n, index: i, bytes }, [bytes.buffer]);
          await wait(`visit:${n}:${i}`);
        },
        job(n, signal),
      );
      post({ type: "answer", n });
    },
  });
  return async (/** @type {any} */ message) => {
    const { type, n } = message ?? {};
    if (type === "bytes") settle(`read:${n}`, message, message.bytes);
    else if (type === "visited") settle(`visit:${n}:${message.index}`, message, undefined);
    else if (type === "cancel") jobs.get(n)?.abort();
    else if (ops[type]) {
      const controller = new AbortController();
      jobs.set(n, controller);
      try {
        await /** @type {any} */ (ops[type])(message, controller.signal);
      } catch (error) {
        const { name = "Error", message: text = String(error) } = /** @type {any} */ (error ?? {});
        post({ type: "failed", n, name, message: text });
      } finally {
        jobs.delete(n);
      }
    }
  };
}

if (typeof document === "undefined" && typeof globalThis.postMessage === "function") {
  const scope = /** @type {any} */ (globalThis);
  const post = (/** @type {any} */ data, /** @type {Transferable[]} */ transfer = []) =>
    scope.postMessage(data, transfer);
  const handle = createLibraryHandler(
    post,
    (folder) => import(/* @vite-ignore */ libraryUrl(folder, import.meta.url)),
  );
  scope.onmessage = (/** @type {MessageEvent} */ event) => void handle(event.data);
  post({ type: "ready" });
}
