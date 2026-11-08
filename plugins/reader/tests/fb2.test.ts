// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFb2 } from "../ui/formats/fb2.js";
import { fb2 } from "./build/books";

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

describe("FictionBook 2", () => {
  it("sections become chapters and contents, with titles, emphasis and notes", async () => {
    const book = readFb2(fb2());
    expect(book).toMatchObject({ kind: "chapters", format: "FB2", title: "The Lantern Keeper" });
    expect(book.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two", "Notes"]);
    expect(book.toc).toEqual([
      expect.objectContaining({ title: "Chapter One", unit: 0 }),
      expect.objectContaining({
        title: "Chapter Two",
        unit: 1,
        children: [expect.objectContaining({ title: "A smaller part", unit: 1 })],
      }),
      expect.objectContaining({ title: "Notes", unit: 2 }),
    ]);
    const one = parse((await book.chapter(0)).html);
    expect(one.querySelector("h1")?.textContent).toBe("Chapter One");
    expect(one.querySelector("em")?.textContent).toBe("lantern");
    expect(one.querySelector("strong")?.textContent).toBe("dusk");
    const note = one.querySelector("a")?.getAttribute("href") ?? "";
    expect(book.target(note, 0)).toEqual({ unit: 2, anchor: "n1" });
    const two = await book.chapter(1);
    expect(two.html).not.toMatch(/onclick|steal/);
    expect(await book.text(1)).toContain("The road bent east and the lantern swung.");
  });

  it("its base64 binary becomes the image's data: URL", async () => {
    const book = readFb2(fb2());
    const image = parse((await book.chapter(0)).html).querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });
});
