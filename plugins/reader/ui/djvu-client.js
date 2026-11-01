// DjVu decoding that does not hold up the surface: in the library worker (library-client.js), so
// the frame's main thread only reads and draws. Where no worker starts or it cannot load
// endue.formats, the decoder runs in the frame, giving the event loop a turn every 25 ms.
import { openDocument } from "./formats/djvu-document.js";
import { connect, startLibraryWorker, unavailable } from "./library-client.js";

/**
 * @typedef {import("./formats/djvu-document.js").DjvuDocument} DjvuDocument
 * @typedef {import("./library-client.js").Source} Source
 * @typedef {import("./library-client.js").StartWorker} StartWorker
 */

/** @param {import("./library-client.js").Link} link @param {Source} source @param {AbortSignal} [signal] @returns {Promise<DjvuDocument>} */
async function inWorker(link, source, signal) {
  const stop = () => link.close();
  signal?.addEventListener("abort", stop, { once: true });
  /** @type {any} */
  let opened;
  try {
    opened = await link.ask({ type: "open", kind: "djvu", size: source.size }, { signal });
  } catch (error) {
    link.close();
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  return {
    title: opened.title,
    note: opened.note,
    pages: opened.pages,
    outline: opened.outline ?? [],
    async render(index, { scale, signal: cancel }) {
      const { width, height, rgba, bitmap, note } = await link.ask(
        { type: "render", index, scale },
        { signal: cancel },
      );
      return { width, height, rgba, bitmap, note };
    },
    text: async (index) => (await link.ask({ type: "text", index })).value ?? null,
    stopped: () => link.stopped(),
    close: () => link.close(),
  };
}

/**
 * Open a DjVu document in the library worker when one starts, else in the frame.
 * @param {Source} source
 * @param {{ startWorker?: StartWorker, signal?: AbortSignal }} [options]
 * @returns {Promise<DjvuDocument>}
 */
export async function openDjvuDocument(source, { startWorker, signal } = {}) {
  const worker = await startLibraryWorker(startWorker, signal);
  if (worker) {
    try {
      return await inWorker(connect(worker, source), source, signal);
    } catch (error) {
      if (!unavailable(error)) throw error;
    }
  }
  const { openDjvu } = await import("@endue-ai/formats/djvu/index.js");
  signal?.throwIfAborted();
  return openDocument(openDjvu, source);
}
