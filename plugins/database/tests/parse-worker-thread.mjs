// A Node worker thread that runs a browser module worker for the tests: postMessage and onmessage on
// the global scope as a page's worker has them, fetch reading file: URLs from disk (the parse worker
// fetches its wasm next to itself), then the worker module at `workerData.url`.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const scope = /** @type {any} */ (globalThis);
const webFetch = globalThis.fetch;

scope.postMessage = (/** @type {unknown} */ message) => port.postMessage(message);
scope.fetch = async (/** @type {URL | string} */ url, /** @type {RequestInit} */ init) => {
  const href = String(url);
  if (!href.startsWith("file:")) return webFetch(url, init);
  try {
    return new Response(await readFile(new URL(href)));
  } catch {
    return new Response(null, { status: 404 });
  }
};
// What the page sends before the module has loaded waits for it, as a worker's queue does.
/** @type {unknown[] | null} */
let early = [];
port.on("message", (data) => (early ? early.push(data) : scope.onmessage?.({ data })));

await import(workerData.url);
const queued = early;
early = null;
for (const data of queued) scope.onmessage?.({ data });
