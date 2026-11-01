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
