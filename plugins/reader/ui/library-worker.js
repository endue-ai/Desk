// The library worker: endue.formats' decoders off the frame's main thread, one worker per open file,
// started with the SDK's startWorker (library-client.js). It asks the frame for byte ranges and
// answers a DjVu document's facts, text and pages (ImageBitmaps, or RGBA where a worker cannot make
// them), or an archive's listing and entries, a solid archive's in one pass that waits for the frame
// after each entry. Import maps do not reach workers, so the library is imported by its URL: the desk
// serves plugins by id, endue.formats at /endue.formats/ on the plugin's own scheme.
import { openDocument } from "./formats/djvu-document.js";

const FOLDERS = /** @type {Record<string, string>} */ ({
  djvu: "djvu",
  rar: "rar",
  sevenzip: "sevenzip",
});

/** The URL of a library folder's index on the scheme `base` is on. @param {string} kind @param {string | URL} base */
export const libraryUrl = (kind, base) =>
  new URL(`/endue.formats/lib/${FOLDERS[kind] ?? "missing"}/index.js`, base).href;

/** @param {import("./formats/djvu-document.js").Raster} raster */
async function bitmapOf({ width, height, rgba }) {
  if (!rgba || typeof createImageBitmap !== "function" || typeof ImageData !== "function")
    return undefined;
  const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return createImageBitmap(new ImageData(pixels, width, height));
}

/**
 * What the worker does with each message; the tests run it on their own thread.
 * @param {(data: any, transfer?: Transferable[]) => void} post
 * @param {(kind: string) => Promise<any>} load the library module of a kind
 */
export function createLibraryHandler(post, load) {
  /** Reads, and entries handed to the frame, waiting for its answer. @type {Map<string, { resolve(value: any): void, reject(error: unknown): void }>} */
  const waiting = new Map();
  /** @type {Map<number, AbortController>} */
  const jobs = new Map();
  let asked = 0;
  /** @type {import("./formats/djvu-document.js").DjvuDocument | undefined} */
  let doc;
  /** @type {any} */
  let archive;
  const wait = (/** @type {string} */ key) =>
    new Promise((resolve, reject) => waiting.set(key, { resolve, reject }));
  const settle = (
    /** @type {string} */ key,
    /** @type {any} */ message,
    /** @type {any} */ value,
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
  const library = async (/** @type {string} */ kind) => {
    try {
      return await load(kind);
    } catch (error) {
      throw Object.assign(new Error(`endue.formats could not be loaded: ${error}`), {
        name: "LibraryUnavailable",
      });
    }
  };
  /** Bytes the frame may take: a copy when they share a larger buffer. @param {Uint8Array} bytes */
  const own = (bytes) =>
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  /** @param {number} n @param {(signal: AbortSignal) => Promise<void>} work */
  const answer = async (n, work) => {
    const job = new AbortController();
    jobs.set(n, job);
    try {
      await work(job.signal);
    } catch (error) {
      const { name = "Error", message = String(error) } = /** @type {any} */ (error ?? {});
      post({ type: "failed", n, name, message });
    } finally {
      jobs.delete(n);
    }
  };
  const ops = /** @type {Record<string, (message: any, signal: AbortSignal) => Promise<void>>} */ ({
    async open({ n, kind, size, name }) {
      const lib = await library(kind);
      if (kind === "djvu") {
        doc = await openDocument(lib.openDjvu, source(size));
        const { title, note, pages, outline } = doc;
        return post({ type: "answer", n, title, note, pages, outline });
      }
      const input = source(size);
      archive = kind === "rar" ? await lib.openRar(input) : await lib.openSevenZip(input, name);
      const { format, entries, details, note, refusal } = archive;
      post({ type: "answer", n, format, entries, details, note, refusal });
    },
    async text({ n, index }) {
      post({ type: "answer", n, value: await doc?.text(index) });
    },
    async render({ n, index, scale }, signal) {
      const raster = await /** @type {any} */ (doc).render(index, { scale, signal });
      const { width, height, note } = raster;
      const bitmap = await bitmapOf(raster).catch(() => undefined);
      if (bitmap) return post({ type: "answer", n, width, height, note, bitmap }, [bitmap]);
      const rgba = own(raster.rgba ?? new Uint8Array(0));
      post({ type: "answer", n, width, height, note, rgba }, [rgba.buffer]);
    },
    async entry({ n, index }) {
      const bytes = own(await archive.read(archive.entries[index]));
      post({ type: "answer", n, bytes }, [bytes.buffer]);
    },
    async each({ n, indices }) {
      const entries = /** @type {any[]} */ (archive.entries);
      const at = new Map(entries.map((entry, i) => [entry, i]));
      await archive.each(
        indices.map((/** @type {number} */ i) => entries[i]),
        async (/** @type {any} */ entry, /** @type {Uint8Array} */ raw) => {
          const bytes = raw.slice();
          const index = at.get(entry);
          post({ type: "entry", n, index, bytes }, [bytes.buffer]);
          await wait(`visit:${n}:${index}`);
        },
      );
      post({ type: "answer", n });
    },
  });
  return async (/** @type {any} */ message) => {
    const { type, n } = message ?? {};
    if (type === "bytes") settle(`read:${n}`, message, message.bytes);
    else if (type === "visited") settle(`visit:${n}:${message.index}`, message, undefined);
    else if (type === "cancel") jobs.get(n)?.abort();
    else if (ops[type])
      await answer(n, (signal) => /** @type {any} */ (ops[type])(message, signal));
  };
}

if (typeof document === "undefined" && typeof globalThis.postMessage === "function") {
  const scope = /** @type {any} */ (globalThis);
  const post = (/** @type {any} */ data, /** @type {Transferable[]} */ transfer = []) =>
    scope.postMessage(data, transfer);
  const handle = createLibraryHandler(
    post,
    (kind) => import(/* @vite-ignore */ libraryUrl(kind, import.meta.url)),
  );
  scope.onmessage = (/** @type {MessageEvent} */ event) => void handle(event.data);
  post({ type: "ready" });
}
