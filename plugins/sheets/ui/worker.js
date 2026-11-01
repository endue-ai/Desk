// This module imports only relative files: import maps do not reach a module worker.
import { openBook } from "./book.js";
import { packSheet, transfers } from "./wire.js";

/** @typedef {{ type: "sheet", sheet: import("./wire.js").PackedSheet, total: number } | { type: "progress", done: number, total: number } | { type: "done", book: import("./book.js").Book }} Reply */
/** @param {{ bytes: Uint8Array, name: string, encoding?: string }} file @param {(reply: Reply, buffers?: ArrayBuffer[]) => void} send */
export function handleOpen(file, send) {
  let count = 0;
  const emit = (sheet, total) => {
    const packed = packSheet(sheet, (done, total) => send({ type: "progress", done, total }));
    send({ type: "sheet", sheet: packed, total }, transfers(packed));
    count++;
  };
  const book = openBook(file.bytes, { ...file, onSheet: emit });
  if (book.kind === "sheets" && count === 0) {
    for (const sheet of book.sheets) emit(sheet, book.sheets.length);
  }
  send({ type: "done", book: book.kind === "sheets" ? { ...book, sheets: [] } : book });
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) =>
    handleOpen(event.data, (reply, buffers = []) => globalThis.postMessage(reply, buffers));
}
