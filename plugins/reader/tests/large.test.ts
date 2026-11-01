// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openPdf } from "../ui/formats/pdf.js";
import { readZip } from "../ui/formats/zip.js";
import { zip } from "./build/archive";
import { largePdf } from "./build/large-pdf";
import { loadPdfjs } from "./pdfjs";

const sourceOf = (bytes: Uint8Array) => {
  const reads: Array<[number, number]> = [];
  return {
    reads,
    size: bytes.length,
    async read(offset: number, length: number) {
      reads.push([offset, length]);
      return bytes.slice(offset, offset + length);
    },
  };
};

describe("large document ranges", () => {
  it("pdf.js reads only requested ranges to open and read page one of forty", async () => {
    const source = sourceOf(largePdf());
    const book = await openPdf(source as never, { pdfjs: await loadPdfjs() });
    try {
      expect(book.pages).toHaveLength(40);
      expect(await book.text(0)).toContain("Range page 1");
      expect(source.reads.some(([start]) => start > source.size / 2)).toBe(true);
      expect(source.reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(
        source.size / 4,
      );
    } finally {
      await book.close();
    }
  });

  it("ZIP books read the directory and requested entry, leaving unused content unread", async () => {
    const source = sourceOf(
      zip([
        ["chapter.xhtml", "<p>The first chapter.</p>"],
        ["unused.bin", new Uint8Array(2 * 1024 * 1024), { store: true }],
      ]),
    );
    const archive = await readZip(source as never);
    expect(archive.names).toEqual(["chapter.xhtml", "unused.bin"]);
    expect(await archive.text("chapter.xhtml")).toBe("<p>The first chapter.</p>");
    expect(source.reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(source.size / 8);
  });
});

it("cancels a pending PDF range without returning a damaged-file card", async () => {
  const stop = new AbortController();
  const source = {
    size: 10 * 1024 * 1024,
    read: () =>
      new Promise<Uint8Array>((_, reject) => {
        if (stop.signal.aborted) reject(stop.signal.reason);
        else
          stop.signal.addEventListener("abort", () => reject(stop.signal.reason), { once: true });
      }),
  };
  const result = openPdf(
    source as never,
    { pdfjs: await loadPdfjs(), signal: stop.signal } as never,
  ).catch((error) => error);
  stop.abort();
  expect(await result).toMatchObject({ name: "AbortError" });
});

it("opening the first EPUB chapter leaves an unrelated large ZIP entry unread", async () => {
  const { epub } = await import("./build/books");
  const { openBook } = await import("../ui/open.js");
  const base = await readZip(epub(3));
  const entries: import("./build/archive").Entry[] = [];
  for (const name of base.names) entries.push([name, await base.read(name)]);
  entries.push(["unused.bin", new Uint8Array(2 * 1024 * 1024), { store: true }]);
  const source = sourceOf(zip(entries));
  const book = await openBook(source, { name: "large.epub", path: "large.epub" });
  expect(book.kind).toBe("chapters");
  if (book.kind !== "chapters") return;
  expect((await book.chapter(0)).html).toContain("lantern");
  expect(source.reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(source.size / 8);
});

it("cancellation while the first PDF page is pending releases the owned worker", async () => {
  const { vi } = await import("vitest");
  const stop = new AbortController();
  const close = vi.fn();
  const destroy = vi.fn(async () => {});
  let started!: () => void;
  const pageStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const doc = {
    getPage: () => {
      started();
      return new Promise(() => {});
    },
  };
  const pdfjs = {
    createWorker: async () => ({ worker: {}, close }),
    getDocument: () => ({ promise: Promise.resolve(doc), destroy }),
  };
  const pending = openPdf(new Uint8Array(), { pdfjs, signal: stop.signal }).catch((e) => e);
  await pageStarted;
  stop.abort();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(destroy).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it("Cancel during a later PDF page measurement aborts its range and destroys the task", async () => {
  const { vi } = await import("vitest");
  const stop = new AbortController();
  const worker = { close: vi.fn(), worker: {} };
  const destroy = vi.fn(async () => {});
  let reading!: () => void;
  const begun = new Promise<void>((resolve) => {
    reading = resolve;
  });
  let transport: { requestDataRange(begin: number, end: number): void };
  let rangeAborted = false;
  class Range {
    abort() {
      rangeAborted = true;
    }
  }
  const readStop = new AbortController();
  const source = {
    size: 10_000_000,
    cancel: (reason: unknown) => readStop.abort(reason),
    read: () => {
      reading();
      return new Promise<Uint8Array>((_, reject) =>
        readStop.signal.addEventListener("abort", () => reject(readStop.signal.reason), {
          once: true,
        }),
      );
    },
  };
  const pdfjs = {
    PDFDataRangeTransport: Range,
    createWorker: async () => worker,
    getDocument: (options: { range: typeof transport }) => {
      transport = options.range;
      const abort = transport as typeof transport & { abort(): void };
      const original = abort.abort.bind(abort);
      abort.abort = () => {
        rangeAborted = true;
        original();
      };
      return {
        destroy,
        promise: Promise.resolve({
          numPages: 40,
          getPage: (i: number) => {
            if (i === 1)
              return Promise.resolve({ getViewport: () => ({ width: 100, height: 200 }) });
            transport.requestDataRange(100_000, 200_000);
            return new Promise(() => {});
          },
          getOutline: async () => [],
          getMetadata: async () => ({}),
        }),
      };
    },
  };
  const book = await openPdf(source as never, { pdfjs });
  const pending = book.measure(20, stop.signal).catch((error) => error);
  await begun;
  stop.abort();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(rangeAborted).toBe(true);
  expect(readStop.signal.aborted).toBe(true);
  expect(worker.close).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});
