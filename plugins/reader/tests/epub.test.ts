// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readEpub } from "../ui/formats/epub.js";
import { readZip } from "../ui/formats/zip.js";
import { epub } from "./build/books";

const open = async (version: 2 | 3) => readEpub(await readZip(epub(version)));

describe("EPUB", () => {
  it("reads the spine in order, not the manifest's order", async () => {
    const book = await open(3);
    expect(book.kind).toBe("chapters");
    expect(book.format).toBe("EPUB 3");
    expect(book.title).toBe("Two Roads");
    expect(book.chapters.map((c) => c.href)).toEqual([
      "OEBPS/text/intro.xhtml",
      "OEBPS/text/road.xhtml",
      "OEBPS/text/end.xhtml",
    ]);
  });

  it.each([3, 2] as const)("the table of contents from %s's nav.xhtml or toc.ncx", async (v) => {
    const book = await open(v);
    expect(book.format).toBe(`EPUB ${v}`);
    expect(book.toc).toEqual([
      { title: "Introduction", unit: 0, children: [] },
      {
        title: "The Road",
        unit: 1,
        children: [{ title: "The bend", unit: 1, anchor: "bend", children: [] }],
      },
      { title: "The End", unit: 2, children: [] },
    ]);
  });

  it("a chapter loses its scripts, event handlers, frames, forms and remote URLs", async () => {
    const book = await open(3);
    const { html, css } = await book.chapter(0);
    expect(html).toContain("The lantern was lit at dusk.");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bon\w+=/i);
    expect(html).not.toMatch(/steal|javascript:|<iframe|<form|<input/i);
    expect(html).not.toContain("example.com/pixel.png");
    expect(css.join("\n")).not.toMatch(/example\.com|@import|@font-face/);
  });

  it("an image becomes a data: URL and internal links name their chapter", async () => {
    const book = await open(3);
    const { html, css } = await book.chapter(0);
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const image = doc.querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(image?.getAttribute("alt")).toBe("A dot");
    const link = [...doc.querySelectorAll("a")].find((a) => a.textContent?.includes("bend"));
    expect(book.target(link?.getAttribute("href") ?? "", 0)).toEqual({ unit: 1, anchor: "bend" });
    // The book's own CSS is kept for its shadow root, with its image inlined too.
    expect(css.join("\n")).toMatch(/font-size: 1\.6em/);
    expect(css.join("\n")).toMatch(/url\("data:image\/png;base64,/);
    expect(await book.text(1)).toContain("The lantern swung.");
  });
});
