// The import's worker (PG-60), started with the SDK's startWorker (client.js): a file's sample and
// its bytes, turned into COPY lines here, off the frame's thread; an `.xlsx` by the vendored reader,
// which only this worker loads. It imports only relative files: import maps do not reach a module
// worker.
import * as XLSX from "../vendor/sheetjs/xlsx.mjs";
import { answer } from "./answer.js";
import { xlsxRows } from "./xlsx.js";

const readers = {
  xlsx: (/** @type {Uint8Array} */ bytes) =>
    xlsxRows(/** @type {import("./xlsx.js").Sheetjs} */ (/** @type {unknown} */ (XLSX)), bytes),
};
/** @type {{ transform?: ReturnType<typeof import("./transform.js").createTransform> }} */
const held = {};

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => {
    globalThis.postMessage(answer(held, event.data, readers));
  };
}
