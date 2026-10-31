// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readMobi } from "../ui/formats/mobi.js";
import { palmdoc, readPdb } from "../ui/formats/palm.js";
import { openBook } from "../ui/open.js";
import { kf8, mobi6 } from "./build/mobi";

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)),
  );

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

describe("MOBI, AZW, AZW3 and PRC", () => {
  it("PalmDOC decompression of a known record: literals, space pairs, a back-reference, a run", () => {
    const record = bytes(
      "The",
      [0xec],
      "antern",
      [0xec],
      "it",
      [0xf4],
      "he",
      [0x80, 0x85],
      ".",
      [0x03, 0x01, 0xc3, 0xa9],
    );
    expect(palmdoc(record)).toEqual(bytes("The lantern lit the lantern.", [0x01, 0xc3, 0xa9]));
    // A back-reference may overlap what it copies.
    expect(new TextDecoder().decode(palmdoc(bytes("ab", [0x80, 0x13])))).toBe("abababab");
  });

  it("a MOBI 6 book: its records, text in chapters, an image, filepos links and its NCX", async () => {
    const file = mobi6();
    const pdb = readPdb(file);
    expect(pdb).toMatchObject({ type: "BOOK", creator: "MOBI" });
    const book = await readMobi(file);
    expect(book).toMatchObject({ kind: "chapters", format: "MOBI", title: "The Lantern Keeper" });
    expect(book.chapters).toHaveLength(3);
    const one = await book.chapter(1);
    expect(one.html).toContain("The lantern was lit at dusk.");
    expect(one.html).toContain("Filler paragraph 59");
    expect(parse(one.html).querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/png;base64,iVBORw0KGgo/,
    );
    const contents = parse((await book.chapter(0)).html);
    const link = contents.querySelector("a[href]")?.getAttribute("href") ?? "";
    expect(book.target(link, 0)).toMatchObject({ unit: 1 });
    const two = await book.chapter(2);
    expect(two.html).not.toMatch(/<script|steal/);
    expect(await book.text(2)).toContain("The lantern swung on its hook.");
    expect(book.toc).toEqual([
      expect.objectContaining({ title: "Contents", unit: 0 }),
      expect.objectContaining({ title: "Chapter One", unit: 1 }),
      expect.objectContaining({ title: "Chapter Two", unit: 2 }),
    ]);
  });

  it("HUFF/CDIC compression reads to the same text", async () => {
    const book = await readMobi(mobi6({ compression: "huffcdic" }));
    expect(book.chapters).toHaveLength(3);
    expect(await book.text(1)).toContain("The lantern was lit at dusk.");
  });

  it("a KF8 book: parts from skeletons and fragments, its CSS flow, kindle: links and images", async () => {
    const book = await readMobi(kf8());
    expect(book).toMatchObject({
      kind: "chapters",
      format: "KF8",
      title: "The Lantern Keeper (KF8)",
    });
    expect(book.chapters).toHaveLength(2);
    const one = await book.chapter(0);
    expect(one.html).toContain("The lantern was lit at dusk.");
    expect(one.css.join("\n")).toContain("#336699");
    const page = parse(one.html);
    expect(page.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    const link = page.querySelector("a[href]")?.getAttribute("href") ?? "";
    expect(book.target(link, 0)).toMatchObject({ unit: 1 });
    const two = await book.chapter(1);
    expect(two.html).toContain("The lantern swung on its hook.");
    expect(two.html).not.toMatch(/onclick|steal/);
    expect(book.toc).toEqual([
      expect.objectContaining({ title: "Chapter One", unit: 0 }),
      expect.objectContaining({ title: "Chapter Two", unit: 1 }),
    ]);
  });

  it("Topaz and KFX books open the details view and say which Kindle format they are", async () => {
    const topaz = await openBook(bytes("TPZ0", [0, 0, 0, 0]), {
      name: "old.azw",
      path: "~/old.azw",
    });
    expect(topaz).toMatchObject({ kind: "details", format: "Topaz" });
    const kfx = await openBook(bytes("CONT", [2, 0, 0, 0]), { name: "new.azw", path: "~/new.azw" });
    expect(kfx).toMatchObject({ kind: "details", format: "KFX" });
  });

  it("a DRM flag opens the details view", async () => {
    const book = await openBook(mobi6({ encryption: 2 }), {
      name: "locked.azw",
      path: "~/locked.azw",
    });
    expect(book).toMatchObject({
      kind: "details",
      name: "locked.azw",
      format: "MOBI",
      why: "This book is protected by DRM.",
    });
  });
});
