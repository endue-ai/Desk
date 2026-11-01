import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

class Port extends EventTarget {
  terminate = vi.fn();
}
const implementation = async () => {
  expect(
    existsSync(join(import.meta.dirname, "../ui/pdf-worker.js")),
    "PDF worker ownership is implemented",
  ).toBe(true);
  return import("../ui/pdf-worker.js");
};

it("uses the SDK worker port after the vendored worker announces readiness", async () => {
  const { createPdfWorker } = await implementation();
  const port = new Port();
  const worker = { promise: Promise.resolve(), destroy: vi.fn() };
  const lib = { PDFWorker: { create: vi.fn(() => worker) } };
  const start = vi.fn(() => port);
  const fallback = vi.fn();
  const pending = createPdfWorker(lib, start, { fallback });
  port.dispatchEvent(
    new MessageEvent("message", {
      data: { sourceName: "worker", targetName: "main", action: "ready", data: new Uint8Array() },
    }),
  );
  const own = await pending;
  expect(start.mock.calls[0]?.[0].href).toMatch(/vendor\/pdf\.worker\.min\.mjs$/);
  expect(lib.PDFWorker.create).toHaveBeenCalledWith({ port });
  expect(fallback).not.toHaveBeenCalled();
  own.close();
  expect(port.terminate).toHaveBeenCalledOnce();
  expect(worker.destroy).toHaveBeenCalledOnce();
});

it("falls back to the in-frame worker when the module cannot start", async () => {
  const { createPdfWorker } = await implementation();
  const port = new Port();
  const worker = { promise: Promise.resolve(), destroy: vi.fn() };
  const lib = { PDFWorker: { create: vi.fn(() => worker) } };
  const fallback = vi.fn(async () => {});
  const pending = createPdfWorker(lib, () => port, { fallback });
  port.dispatchEvent(new Event("error"));
  const own = await pending;
  expect(port.terminate).toHaveBeenCalledOnce();
  expect(fallback).toHaveBeenCalledOnce();
  expect(lib.PDFWorker.create).toHaveBeenCalledWith({});
  own.close();
});
