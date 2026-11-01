// The DjVu worker: endue.formats' decoder off the frame's main thread, started with the SDK's
// startWorker by djvu-client.js. It asks the frame for byte ranges and answers the document's facts,
// a page's text, and pages as ImageBitmaps (RGBA where a worker cannot make one). Import maps do not
// reach workers, so the library is imported by its URL: the desk serves plugins by id, endue.formats
// at /endue.formats/ on the plugin's own scheme.
import { openDocument } from "./formats/djvu-document.js";

/** The library's URL on the scheme `base` is on. @param {string | URL} base */
export const libraryUrl = (base) => new URL("/endue.formats/lib/djvu/index.js", base).href;

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
 * @param {(source: any) => Promise<any>} openDjvu
 */
export function createDjvuHandler(post, openDjvu) {
  /** @type {Map<number, { resolve(bytes: Uint8Array): void, reject(error: unknown): void }>} */
  const reads = new Map();
  /** @type {Map<number, AbortController>} */
  const jobs = new Map();
  let asked = 0;
  /** @type {import("./formats/djvu-document.js").DjvuDocument | undefined} */
  let doc;
  const opened = () => {
    if (!doc) throw new Error("The DjVu document is not open.");
    return doc;
  };
  const source = (/** @type {number} */ size) => ({
    size,
    read: (/** @type {number} */ offset, /** @type {number} */ length) =>
      /** @type {Promise<Uint8Array>} */ (
        new Promise((resolve, reject) => {
          const n = ++asked;
          reads.set(n, { resolve, reject });
          post({ type: "read", n, offset, length });
        })
      ),
  });
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
  return async (/** @type {any} */ message) => {
    const { type, n } = message ?? {};
    if (type === "bytes") {
      const read = reads.get(n);
      reads.delete(n);
      if (message.error === undefined) read?.resolve(message.bytes);
      else read?.reject(Object.assign(new Error(message.error), { name: message.name }));
    } else if (type === "cancel") jobs.get(n)?.abort();
    else if (type === "open")
      await answer(n, async () => {
        doc = await openDocument(openDjvu, source(message.size));
        const { title, note, pages, outline } = doc;
        post({ type: "opened", n, title, note, pages, outline });
      });
    else if (type === "text")
      await answer(n, async () =>
        post({ type: "answer", n, value: await opened().text(message.index) }),
      );
    else if (type === "render")
      await answer(n, async (signal) => {
        const raster = await opened().render(message.index, { scale: message.scale, signal });
        const { width, height, note } = raster;
        const bitmap = await bitmapOf(raster).catch(() => undefined);
        if (bitmap) return post({ type: "rendered", n, width, height, note, bitmap }, [bitmap]);
        const rgba = raster.rgba?.slice() ?? new Uint8Array(0);
        post({ type: "rendered", n, width, height, note, rgba }, [rgba.buffer]);
      });
  };
}

if (typeof document === "undefined" && typeof globalThis.postMessage === "function") {
  const scope = /** @type {any} */ (globalThis);
  const post = (/** @type {any} */ data, /** @type {Transferable[]} */ transfer = []) =>
    scope.postMessage(data, transfer);
  import(/* @vite-ignore */ libraryUrl(import.meta.url)).then(
    ({ openDjvu }) => {
      const handle = createDjvuHandler(post, openDjvu);
      scope.onmessage = (/** @type {MessageEvent} */ event) => void handle(event.data);
      post({ type: "ready" });
    },
    (error) => post({ type: "unavailable", message: String(error?.message ?? error) }),
  );
}
