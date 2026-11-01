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
  const start = vi.fn((_url: URL) => port);
  const fallback = vi.fn();
  const pending = createPdfWorker(lib, start, { fallback });
  port.dispatchEvent(
    new MessageEvent("message", {
      data: { sourceName: "worker", targetName: "main", action: "ready", data: new Uint8Array() },
    }),
  );
  const own = await pending;
  expect(start.mock.calls[0]?.[0]?.href).toMatch(/vendor\/pdf\.worker\.min\.mjs$/);
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

it("cancels startup without creating a fallback worker", async () => {
  const { createPdfWorker } = await implementation();
  const stop = new AbortController();
  const port = new Port();
  const create = vi.fn();
  const fallback = vi.fn();
  const pending = createPdfWorker({ PDFWorker: { create } }, () => port, {
    fallback,
    signal: stop.signal,
  }).catch((error) => error);
  stop.abort();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(port.terminate).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it("cancels after readiness while PDFWorker initialization is still pending", async () => {
  const { createPdfWorker } = await implementation();
  const stop = new AbortController();
  const port = new Port();
  const worker = { promise: new Promise(() => {}), destroy: vi.fn() };
  const create = vi.fn(() => worker);
  const fallback = vi.fn();
  const pending = createPdfWorker({ PDFWorker: { create } }, () => port, {
    fallback,
    signal: stop.signal,
  }).catch((error) => error);
  port.dispatchEvent(
    new MessageEvent("message", {
      data: { sourceName: "worker", targetName: "main", action: "ready" },
    }),
  );
  await Promise.resolve();
  expect(create).toHaveBeenCalledOnce();
  stop.abort();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(worker.destroy).toHaveBeenCalledOnce();
  expect(port.terminate).toHaveBeenCalledOnce();
  expect(fallback).not.toHaveBeenCalled();
});
