// Owns one parsing worker. Abort terminates it; completion releases it. The UI receives ready-to-
// use sheet buffers, so installing a sheet is independent of its number of cells.
import { formatOf } from "./detect.js";
import { unpackSheet } from "./wire.js";

/** @typedef {import("./book.js").Book} Book */
/** @typedef {{ signal: AbortSignal, sheet(book: Book): void, progress(done: number, total: number): void }} ParseOptions */
/** @param {Uint8Array} bytes @param {{ name: string, encoding: string }} file @param {ParseOptions} options @returns {Promise<Book>} */
export function parseInWorker(bytes, file, { signal, sheet, progress }, startWorker) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = startWorker(new URL("./worker.js", import.meta.url), { name: "sheets-parser" });
    const sheets = [];
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Parsing cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "The spreadsheet parser stopped."));
    };
    worker.onmessage = ({ data }) => {
      if (signal.aborted) return;
      if (data.type === "progress") progress(data.done, data.total);
      else if (data.type === "sheet") {
        sheets.push(unpackSheet(data.sheet));
        sheet({ kind: "sheets", format: formatOf(file.name), detail: "", sheets: [...sheets] });
      } else if (data.type === "done") {
        cleanup();
        resolve(data.book.kind === "sheets" ? { ...data.book, sheets } : data.book);
      }
    };
    worker.postMessage({ bytes, ...file }, [bytes.buffer]);
  });
}
