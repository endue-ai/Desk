import { describe, expect, it } from "vitest";
import { readComic } from "../ui/formats/comics.js";
import { readTar } from "../ui/formats/tar.js";
import { readZip } from "../ui/formats/zip.js";
import { openBook } from "../ui/open.js";
import { cbt, cbz } from "./build/comics";

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
});
