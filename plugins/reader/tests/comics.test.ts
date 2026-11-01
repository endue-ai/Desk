import { describe, expect, it } from "vitest";
import { readComic } from "../ui/formats/comics.js";
import { readTar } from "../ui/formats/tar.js";
import { readZip } from "../ui/formats/zip.js";
import { openBook } from "../ui/open.js";
import { cbt, cbz, djvu, djvuPage, rar4, rar5, sevenZip } from "./build/comics";

const NOT_YET =
  "This version reads CBZ and CBT comics and PDF; RAR, 7z and DjVu pages are not read yet.";
const NAMES = ["Issue 1/2.jpg", "Issue 1/10.jpg", "Issue 1/1.jpg", "Issue 1/ComicInfo.xml"];

describe("comics", () => {
  it.each([
    ["CBZ", async () => readComic(await readZip(cbz()), "CBZ")],
    ["CBT", async () => readComic(readTar(cbt()), "CBT")],
  ])("%s: the images in natural order, one page each", async (kind, open) => {
    const book = await open();
    expect(book).toMatchObject({ kind: "pages", format: `${kind} comic` });
    expect(book.names).toEqual(["Issue 1/1.png", "Issue 1/2.png", "Issue 1/10.png"]);
    expect(book.pages).toHaveLength(3);
    const first = await book.image(0);
    expect(first.mime).toBe("image/png");
    expect(await book.measure(2)).toEqual({ width: 6, height: 9 });
  });

  it("CBZ through openBook, by its first bytes", async () => {
    const book = await openBook(cbz(), { name: "issue.zip", path: "~/issue.zip" });
    expect(book).toMatchObject({ kind: "pages", format: "CBZ comic" });
  });

  it.each([
    ["RAR 5", rar5(NAMES)],
    ["RAR 4", rar4(NAMES)],
  ])("CBR (%s) opens the details view with its page count", async (version, bytes) => {
    const book = await openBook(bytes, { name: "issue.cbr", path: "~/issue.cbr" });
    expect(book).toMatchObject({
      kind: "details",
      format: `CBR comic (${version})`,
      size: bytes.length,
      why: NOT_YET,
    });
    expect(book.kind === "details" && book.facts).toContainEqual({ label: "Pages", value: "3" });
  });

  it("CB7 opens the details view; its page count is in a compressed header", async () => {
    const book = await openBook(sevenZip(), { name: "issue.cb7", path: "~/issue.cb7" });
    expect(book).toMatchObject({ kind: "details", format: "CB7 comic (7z)", why: NOT_YET });
    expect(book.kind === "details" && book.facts.map((f) => f.label)).not.toContain("Pages");
  });

  it("DjVu opens the details view with its pages and their sizes", async () => {
    const book = await openBook(djvu(), { name: "scan.djvu", path: "~/scan.djvu" });
    expect(book).toMatchObject({ kind: "details", format: "DjVu", why: NOT_YET });
    const facts = book.kind === "details" ? book.facts : [];
    expect(facts).toContainEqual({ label: "Pages", value: "2" });
    expect(facts).toContainEqual({
      label: "Page sizes",
      value: "2550 × 3300 px at 300 dpi; 1700 × 2200 px at 200 dpi",
    });
    const single = await openBook(djvuPage(), { name: "page.djv", path: "~/page.djv" });
    expect(single.kind === "details" && single.facts).toContainEqual({
      label: "Pages",
      value: "1",
    });
  });
});
