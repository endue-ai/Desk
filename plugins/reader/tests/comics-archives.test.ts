// Comics: CBZ and CBT through the plugin's own readers, CB7 and CBR through endue.formats, all with
// their images in natural order, one page each; a solid archive decoded once, in its own order, with
// each page handed over as it comes out; encrypted and damaged archives as the details view with
// the library's sentence.
import { ENCRYPTED, LOCKED, openRar } from "@endue-ai/formats/rar/index.js";
import { describe, expect, it } from "vitest";
import { ORIGINALS } from "../../formats/tests/rar/originals.mjs";
import { readComic } from "../ui/formats/comics.js";
import { readTar } from "../ui/formats/tar.js";
import { readZip } from "../ui/formats/zip.js";
import { openBook } from "../ui/open.js";
import { cb7, counted, library, rar5Stored, renamed } from "./build/comic-archives";
import { COMIC_PAGES, cbt, cbz } from "./build/comics";
import { localWorkers } from "./build/local-worker";

type Comic = {
  kind: "pages";
  format: string;
  names: string[];
  pages: Array<{ width: number; height: number }>;
  image(i: number, signal?: AbortSignal): Promise<{ mime: string; bytes: Uint8Array }>;
  measure(i: number): Promise<{ width: number; height: number }>;
  close?(): unknown;
};
type Details = {
  kind: "details";
  format: string;
  why: string;
  facts: Array<{ label: string; value: string }>;
};

const NATURAL = ["Issue 1/1.png", "Issue 1/2.png", "Issue 1/10.png"];
const PNG = [0x89, 0x50, 0x4e, 0x47];
const open = async (bytes: Uint8Array | ReturnType<typeof counted>, name: string, more = {}) =>
  (await openBook(bytes, { name, path: `~/Comics/${name}`, ...more })) as unknown as
    | Comic
    | Details;
const comic = async (bytes: Uint8Array | ReturnType<typeof counted>, name: string, more = {}) => {
  const book = await open(bytes, name, more);
  if (book.kind !== "pages") throw new Error(`${name} opened as ${JSON.stringify(book)}`);
  return book;
};

/** The solid fixtures' files, renamed as pages of the same length. */
const AS_PAGES = {
  "data.bin": "data.png",
  "tool.exe": "tool.png",
  "text.txt": "text.png",
  "chapters/one.txt": "chapters/one.png",
  "chapters/two.txt": "chapters/two.png",
  "chapters/three.txt": "chapters/three.png",
};
/** What listing an archive and one pass of the library through all of it read. */
const oncePass = async (path: string) => {
  const source = counted(library(path));
  const archive = await openRar(source);
  await archive.each(
    archive.entries.filter((e) => e.kind === "file"),
    async () => {},
  );
  return source.bytesRead;
};
const original = (page: string) => {
  const path = Object.entries(AS_PAGES).find(([, name]) => name === page)?.[0];
  return (ORIGINALS as Record<string, () => Uint8Array>)[path ?? ""]?.();
};

describe("CBZ and CBT", () => {
  it.each([
    ["CBZ", async () => readComic(await readZip(cbz()), "CBZ")],
    ["CBT", async () => readComic(readTar(cbt()), "CBT")],
  ])("%s: the images in natural order, one page each", async (kind, read) => {
    const book = await read();
    expect(book).toMatchObject({ kind: "pages", format: `${kind} comic` });
    expect(book.names).toEqual(NATURAL);
    expect(book.pages).toHaveLength(3);
    expect((await book.image(0)).mime).toBe("image/png");
    expect(await book.measure(2)).toEqual({ width: 6, height: 9 });
  });

  it("CBZ through openBook, by its first bytes", async () => {
    expect(await open(cbz(), "issue.zip")).toMatchObject({ kind: "pages", format: "CBZ comic" });
  });
});

describe("CB7", () => {
  it("bsdtar's solid LZMA2 comic: the images in natural order, one page each", async () => {
    const book = await comic(cb7(), "issue.cb7");
    expect(book.format).toBe("CB7 comic");
    expect(book.names).toEqual(NATURAL);
    expect(book.pages).toHaveLength(3);
    const first = await book.image(0);
    expect(first.mime).toBe("image/png");
    expect([...first.bytes.subarray(0, 4)]).toEqual(PNG);
    expect(await book.measure(2)).toEqual({ width: 6, height: 9 });
  });

  it("7-Zip's comic that is not solid: its one image is the page", async () => {
    const book = await comic(library("sevenzip/copy.7z"), "copy.cb7");
    expect(book.names).toEqual(["image.png"]);
    expect([...(await book.image(0)).bytes.subarray(0, 4)]).toEqual(PNG);
  });

  it("a damaged CB7 opens the details view with the library's sentence", async () => {
    const bytes = cb7();
    bytes[12] = (bytes[12] ?? 0) ^ 0xff;
    const book = await open(bytes, "damaged.cb7");
    expect(book).toMatchObject({
      kind: "details",
      format: "CB7 comic",
      why: "The 7z start header is damaged.",
    });
  });
});

describe("CBR", () => {
  it("a stored RAR 5 comic: the images in natural order, one page each, measured", async () => {
    const book = await comic(rar5Stored(COMIC_PAGES), "issue.cbr");
    expect(book.format).toBe("CBR comic");
    expect(book.names).toEqual(NATURAL);
    expect([...(await book.image(1)).bytes.subarray(0, 4)]).toEqual(PNG);
    expect(await book.measure(2)).toEqual({ width: 6, height: 9 });
  });

  it("rar's compressed RAR 4: the bitmap is the page and decodes through the library", async () => {
    const book = await comic(library("rar/rar4-filters.rar"), "filters.cbr");
    expect(book.names).toEqual(["image.bmp"]);
    const page = await book.image(0);
    expect(page.mime).toBe("image/bmp");
    expect(new TextDecoder().decode(page.bytes.subarray(0, 2))).toBe("BM");
    expect(book.pages[0]?.width).toBeGreaterThan(0);
  });

  it.each(["rar/rar5-solid.rar", "rar/rar4-solid.rar"])(
    "a solid CBR (%s) is decoded once in its order; each page comes out as it decodes",
    async (path) => {
      const source = counted(renamed(library(path), AS_PAGES));
      const book = await comic(source, "solid.cbr");
      expect(book.names).toEqual([...book.names].sort((a, b) => a.localeCompare(b)));
      expect(book.names).toContain("text.png");
      // Opening drew the first page in natural order, chapters/one.png: the pass handed over the
      // pages before it in the archive (data.png, and tool.png in RAR 5) on its way.
      const opened = source.bytesRead;
      const early = book.names.indexOf("data.png");
      expect((await book.image(early)).bytes).toEqual(original("data.png"));
      expect(source.bytesRead).toBe(opened);
      // Every page in natural order (not the archive's): the archive is read about once.
      for (const [i, name] of book.names.entries())
        expect((await book.image(i)).bytes, name).toEqual(original(name));
      expect(source.bytesRead).toBeLessThan((await oncePass(path)) + source.size * 0.2);
      await book.close?.();
    },
  );

  it("Cancel stops a solid pass where it is; the next page asked for goes on from there", async () => {
    const source = counted(renamed(library("rar/rar5-solid.rar"), AS_PAGES));
    const book = await comic(source, "solid.cbr");
    const last = book.names.indexOf("chapters/two.png");
    const stop = new AbortController();
    const waiting = book.image(last, stop.signal).catch((error) => error);
    stop.abort();
    expect(await waiting).toMatchObject({ name: "AbortError" });
    expect((await book.image(last)).bytes).toEqual(original("chapters/two.png"));
    expect(source.bytesRead).toBeLessThan(
      (await oncePass("rar/rar5-solid.rar")) + source.size * 0.2,
    );
    await book.close?.();
  });

  it.each(["rar/rar5-encrypted.rar", "rar/rar4-encrypted.rar"])(
    "an encrypted CBR (%s) opens the details view with the library's sentence",
    async (path) => {
      const book = await open(renamed(library(path), { "text.txt": "text.png" }), "locked.cbr");
      expect(book).toMatchObject({ kind: "details", format: "CBR comic" });
      const details = book as Details;
      expect(details.why).toMatch(/encrypted/i);
      expect(details.facts).toContainEqual({ label: "Problem", value: ENCRYPTED });
      expect(details.facts).toContainEqual({ label: "Pages", value: "1" });
    },
  );

  it.each(["rar/rar5-locked.rar", "rar/rar4-locked.rar"])(
    "a CBR whose names are encrypted (%s) says so in the details view",
    async (path) => {
      const book = await open(library(path), "names.cbr");
      expect(book).toMatchObject({ kind: "details", format: "CBR comic", why: LOCKED });
    },
  );
});

describe("in the library worker", () => {
  it("a CB7 lists and decodes there, and closing the comic ends the worker", async () => {
    const startWorker = localWorkers();
    const book = await comic(cb7(), "issue.cb7", { startWorker });
    expect(startWorker.urls[0]?.href).toMatch(/\/ui\/library-worker\.js$/);
    expect(book.names).toEqual(NATURAL);
    expect([...(await book.image(2)).bytes.subarray(0, 4)]).toEqual(PNG);
    await book.close?.();
    expect(startWorker.workers[0]?.terminated).toBe(true);
  });

  it("a solid CBR's pass runs there, one entry at a time as the frame takes them", async () => {
    const startWorker = localWorkers();
    const book = await comic(renamed(library("rar/rar5-solid.rar"), AS_PAGES), "solid.cbr", {
      startWorker,
    });
    for (const [i, name] of book.names.entries())
      expect((await book.image(i)).bytes, name).toEqual(original(name));
    await book.close?.();
  });

  it("damage there still opens the details view with the library's sentence", async () => {
    const bytes = cb7();
    bytes[12] = (bytes[12] ?? 0) ^ 0xff;
    const book = await open(bytes, "damaged.cb7", { startWorker: localWorkers() });
    expect(book).toMatchObject({ kind: "details", why: "The 7z start header is damaged." });
  });

  it("a worker that cannot load endue.formats leaves the comic to the frame", async () => {
    const startWorker = localWorkers(() => Promise.reject(new Error("404")));
    const book = await comic(rar5Stored(COMIC_PAGES), "issue.cbr", { startWorker });
    expect(book.names).toEqual(NATURAL);
    expect(startWorker.workers[0]?.terminated).toBe(true);
  });
});
