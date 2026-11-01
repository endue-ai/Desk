// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";
import { fb2 } from "./build/books";
import { pdf } from "./build/pdf";
import { disk, file, loadPage, mount } from "./harness";

const PDF = file("~/Books/large.pdf");
const BOOK = file("~/Books/small.fb2");
afterEach(() => vi.restoreAllMocks());

async function pendingPdf() {
  loadPage(document);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  const close = vi.fn();
  const destroy = vi.fn(async () => {});
  const render = vi.fn(() => ({ promise: new Promise(() => {}), cancel: vi.fn() }));
  const createWorker = vi.fn(async () => ({ worker: {}, close }));
  const pdfjs = {
    PDFDataRangeTransport: class {},
    createWorker,
    getDocument: () => ({
      destroy,
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          getViewport: () => ({ width: 100, height: 200, scale: 1 }),
          render,
        }),
        getOutline: async () => [],
        getMetadata: async () => ({}),
      }),
    }),
  };
  const mounted = await mount({
    handlers: disk({ [PDF.path]: pdf(), [BOOK.path]: fb2() }),
    pdfjs: async () => pdfjs,
    view: (app) =>
      createView(document, {
        moved: (at) => app()?.moved(at),
        zoomed: (zoom) => app()?.zoomed(zoom),
        bookmark: (at, label) => app()?.bookmark(at, label),
        note: (at, text) => app()?.note(at, text),
        forget: (kind, index) => app()?.forget(kind, index),
        unlock: (password) => app()?.unlock(password),
        reload: () => app()?.reload(),
      }),
  });
  await mounted.host.command("desk.files.visit", PDF);
  await mounted.settle();
  expect(render).toHaveBeenCalled();
  return { ...mounted, close, destroy, createWorker };
}

it("the desk showing the just-visited buffer preserves its pending PDF decode", async () => {
  const { host, settle, close, destroy, createWorker } = await pendingPdf();
  const canvas = document.querySelector("canvas");
  expect(canvas).not.toBeNull();
  try {
    await host.command("desk.buffers.show", PDF);
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBe(canvas);
    expect(document.activeElement?.id).toBe("doc");
    expect(document.querySelector("desk-progress")?.hidden).toBe(false);

    // A real reload of this same file still creates a new document and releases the old one.
    await host.command("desk.files.revert", PDF);
    await settle();
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    expect(document.querySelector("canvas")).not.toBe(canvas);
  } finally {
    await host.command("desk.buffers.closed", PDF);
  }
});

it("switching away during PDF decoding stops it and returning offers a working Reload", async () => {
  const { host, settle, close, createWorker } = await pendingPdf();
  await host.command("desk.files.visit", BOOK);
  await settle();
  expect(close).toHaveBeenCalledOnce();
  await host.command("desk.buffers.show", PDF);
  await settle();
  const reload = document.querySelector<HTMLButtonElement>(".page[data-cancelled] button");
  expect(reload?.textContent).toBe("Reload document");
  reload?.click();
  await settle();
  expect(createWorker).toHaveBeenCalledTimes(2);
  expect(document.querySelector("canvas")).not.toBeNull();
  expect(document.querySelector(".page[data-cancelled]")).toBeNull();
  await host.command("desk.buffers.closed", PDF);
  await host.command("desk.buffers.closed", BOOK);
});
