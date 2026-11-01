// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { byteSource, readBytes } from "../../../packages/plugin-sdk/src/index";
import { readEpub } from "../ui/formats/epub.js";
import { readZip } from "../ui/formats/zip.js";
import { createLoading } from "../ui/loading.js";
import { epub } from "./build/books";

afterEach(() => vi.unstubAllGlobals());

it("Cancel aborts the actual SDK range request while opening", async () => {
  let requestSignal: AbortSignal | undefined;
  let reading!: () => void;
  const begun = new Promise<void>((resolve) => {
    reading = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init: RequestInit) => {
      requestSignal = init.signal ?? undefined;
      reading();
      return new Promise((_, reject) =>
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
          once: true,
        }),
      );
    }),
  );
  const bridge = {
    call: vi.fn(async () => ({ url: "https://fixture.test/book.pdf", size: 10_000_000 })),
  };
  let cancel = () => {};
  const view = {
    status() {},
    progress: (value: { cancel(): void } | null) => {
      if (value) cancel = value.cancel;
    },
  };
  const loading = createLoading(bridge, view, { byteSource, readBytes, pdfjs: undefined });
  const pending = loading.load("~/book.pdf").catch((error) => error);
  await begun;
  cancel();
  expect(requestSignal?.aborted, "SDK receives and aborts the file lifetime signal").toBe(true);
  expect(await pending).toMatchObject({ message: "Opening book.pdf was cancelled." });
  expect(fetch).toHaveBeenCalledOnce();
  expect(bridge.call).toHaveBeenCalledOnce();
});

it("a cancelled EPUB chapter stops its entry read and can be opened again", async () => {
  const zip = await readZip(epub(3));
  const stop = new AbortController();
  let reading!: () => void;
  const begun = new Promise<void>((resolve) => {
    reading = resolve;
  });
  const seen: Array<AbortSignal | undefined> = [];
  const book = await readEpub({
    ...zip,
    async read(name: string, signal?: AbortSignal) {
      seen.push(signal);
      if (name.endsWith("dot.png") && signal === stop.signal) {
        reading();
        return new Promise<Uint8Array>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      }
      return zip.read(name, signal);
    },
  });
  const pending = book.chapter(0, stop.signal).catch((error) => error);
  await begun;
  stop.abort();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(seen.every((signal) => signal === stop.signal)).toBe(true);
  expect((await book.chapter(0)).html).toContain("lantern");
});

it("cancelling a PDF decode rejects sibling render waits and previously cached pages", async () => {
  const { openPdf } = await import("../ui/formats/pdf.js");
  const { paintPdf } = await import("../ui/pdf-paint.js");
  const stop = new AbortController();
  let begun!: () => void;
  const rendering = new Promise<void>((resolve) => {
    begun = resolve;
  });
  let renders = 0;
  const page = {
    getViewport: () => ({ width: 100, height: 200, scale: 1 }),
    render: () => {
      if (++renders === 2) begun();
      return { promise: new Promise(() => {}), cancel() {} };
    },
  };
  const destroy = vi.fn(async () => {});
  const close = vi.fn();
  const pdfjs = {
    createWorker: async () => ({ worker: {}, close }),
    getDocument: () => ({
      destroy,
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => page,
        getOutline: async () => [],
        getMetadata: async () => ({}),
      }),
    }),
  };
  const book = await openPdf(new Uint8Array(), { pdfjs });
  const context = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({} as CanvasRenderingContext2D);
  const release = book.beginDecode(stop.signal);
  try {
    const pending = [0, 1].map((i) =>
      paintPdf(pdfjs, book, i, document.createElement("div"), 1, { go() {}, external() {} }).catch(
        (error) => error,
      ),
    );
    await rendering;
    stop.abort();
    expect(await Promise.all(pending)).toEqual([
      expect.objectContaining({ name: "AbortError" }),
      expect.objectContaining({ name: "AbortError" }),
    ]);
    await expect(book.page(0)).rejects.toMatchObject({ name: "AbortError" });
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    release();
    context.mockRestore();
  }
});
