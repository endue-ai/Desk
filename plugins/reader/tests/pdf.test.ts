import { describe, expect, it } from "vitest";
import { openPdf, PasswordNeeded } from "../ui/formats/pdf.js";
import { pdf } from "./build/pdf";
import { loadPdfjs } from "./pdfjs";

const pdfjs = await loadPdfjs();

/** pdf.js with getDocument's parameters recorded, to check what the reader asks of it. */
function recorded() {
  const asked: Array<Record<string, unknown>> = [];
  const getDocument = pdfjs.getDocument as (params: Record<string, unknown>) => unknown;
  const lib = {
    ...pdfjs,
    getDocument: (params: Record<string, unknown>) => {
      asked.push(params);
      return getDocument(params);
    },
  };
  return { lib, asked };
}

describe("PDF through the vendored pdf.js", () => {
  it("loads with eval off, no worker and no fetches: pages, outline, text and links", async () => {
    const { lib, asked } = recorded();
    const book = await openPdf(pdf(), { pdfjs: lib });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ isEvalSupported: false, useSystemFonts: true });
    for (const remote of ["url", "cMapUrl", "standardFontDataUrl", "wasmUrl", "iccUrl", "worker"])
      expect(asked[0]?.[remote], remote).toBeUndefined();
    // The worker module was imported first: pdf.js runs its fake worker in this thread.
    expect((globalThis as { pdfjsWorker?: object }).pdfjsWorker).toHaveProperty(
      "WorkerMessageHandler",
    );

    expect(book.kind).toBe("pages");
    expect(book.format).toBe("PDF");
    expect(book.pages).toHaveLength(2);
    expect(book.pages[0]).toEqual({ width: 816, height: 1056 });
    expect(book.toc).toEqual([
      { title: "One", unit: 0, children: [] },
      { title: "Two", unit: 1, children: [{ title: "Two, a section", unit: 1, children: [] }] },
    ]);
    expect(await book.text(1)).toContain("The second page holds the lantern");
    expect(await book.text(0)).toContain("First page of the fixture");
    expect(await book.links(0)).toEqual([
      expect.objectContaining({ unit: 1 }),
      expect.objectContaining({ url: "https://example.com/" }),
    ]);
    await book.close();
  });

  it("a password fixture asks for its password, refuses a wrong one and opens with it", async () => {
    const locked = pdf({ password: "hunter2" });
    const asked = await openPdf(locked, { pdfjs }).catch((error: unknown) => error);
    expect(asked).toBeInstanceOf(PasswordNeeded);
    expect(asked).toMatchObject({ wrong: false });

    const wrong = await openPdf(locked, { pdfjs, password: "letmein" }).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(PasswordNeeded);
    expect(wrong).toMatchObject({ wrong: true });

    const book = await openPdf(locked, { pdfjs, password: "hunter2" });
    expect(book.pages).toHaveLength(2);
    expect(await book.text(1)).toContain("lantern");
    expect(book.toc[0]?.title).toBe("One");
    await book.close();
  });
});
