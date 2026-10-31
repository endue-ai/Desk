// pdf.js for the plugin frame, loaded on the first PDF: the worker module first, which sets
// globalThis.pdfjsWorker, so pdf.js runs its worker in this thread (an opaque-origin frame cannot
// start a Worker), then the main module. Both are the vendored copies in ui/vendor (ADR 0042).

/** @type {Promise<object> | undefined} */
let loading;

export function loadPdfjs() {
  loading ??= import("./vendor/pdf.worker.min.mjs").then(() => import("./vendor/pdf.min.mjs"));
  return loading;
}
