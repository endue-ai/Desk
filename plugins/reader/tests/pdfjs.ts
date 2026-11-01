// Loads the vendored pdf.js (ui/vendor) in Node the way the plugin frame loads it: the worker module
// first, so pdf.js finds globalThis.pdfjsWorker and runs its fake worker in this thread, then the
// main module. CI runs Node 22, which lacks a few built-ins the modern build calls (Node 24+ and
// the desk's WebKit have them); those are filled in here, for the tests only.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Loose = Record<string, unknown>;

function fill(target: object, name: string, value: unknown) {
  if (!(name in target))
    Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

function polyfill() {
  fill(
    Promise,
    "try",
    (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      new Promise((resolve) => resolve(fn(...args))),
  );
  for (const Kind of [Map, WeakMap]) {
    const proto = Kind.prototype as unknown as Loose;
    fill(
      proto,
      "getOrInsert",
      function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      },
    );
    fill(
      proto,
      "getOrInsertComputed",
      function (this: Map<unknown, unknown>, key: unknown, make: (key: unknown) => unknown) {
        if (!this.has(key)) this.set(key, make(key));
        return this.get(key);
      },
    );
  }
  fill(Math, "sumPrecise", (values: Iterable<number>) => {
    let sum = 0;
    for (const value of values) sum += value;
    return sum;
  });
  fill(Uint8Array, "fromBase64", (text: string) => new Uint8Array(Buffer.from(text, "base64")));
  fill(Uint8Array.prototype, "toBase64", function (this: Uint8Array) {
    return Buffer.from(this).toString("base64");
  });
  fill(Uint8Array.prototype, "toHex", function (this: Uint8Array) {
    return Buffer.from(this).toString("hex");
  });
}

const vendor = (name: string) =>
  pathToFileURL(join(import.meta.dirname, "../ui/vendor", name)).href;

/** The vendored pdf.js module, with its worker running in this thread. */
export async function loadPdfjs(): Promise<Loose> {
  polyfill();
  await import(/* @vite-ignore */ vendor("pdf.worker.min.mjs"));
  return (await import(/* @vite-ignore */ vendor("pdf.min.mjs"))) as Loose;
}
