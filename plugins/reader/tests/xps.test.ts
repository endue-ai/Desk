// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { deobfuscate } from "../ui/formats/odttf.js";
import { readXps } from "../ui/formats/xps.js";
import { readZip } from "../ui/formats/zip.js";
import { FONT_GUID, fakeFont, obfuscate, xps } from "./build/xps";

const svgOf = (text: string) => new DOMParser().parseFromString(text, "image/svg+xml");

describe("XPS and OXPS", () => {
  it("each FixedPage is a page of its own size", async () => {
    const book = await readXps(await readZip(xps()));
    expect(book).toMatchObject({ kind: "pages", format: "XPS" });
    expect(book.pages).toEqual([
      { width: 816, height: 1056 },
      { width: 816, height: 1056 },
    ]);
  });

  it("a page draws as SVG: paths, brushes, a transformed and clipped canvas, glyph text", async () => {
    const book = await readXps(await readZip(xps()));
    const page = await book.page(0);
    const svg = svgOf(page.svg);
    expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 816 1056");
    const shapes = [...svg.querySelectorAll("path")].filter((p) => !p.closest("defs"));
    const [triangle, curve] = shapes;
    expect(triangle?.getAttribute("d")).toBe("M10 10L100 10L100 60Z");
    expect(triangle?.getAttribute("fill")).toBe("#3366cc");
    expect(triangle?.getAttribute("stroke")).toBe("#202020");
    expect(triangle?.getAttribute("stroke-width")).toBe("2");
    expect(curve?.getAttribute("d")).toBe("M120 10C130 10 140 20 140 30A5 5 0 0 1 150 40H170V60Z");
    expect(curve?.getAttribute("fill-rule")).toBe("nonzero");
    const gradient = svg.querySelector("linearGradient");
    expect(gradient?.querySelectorAll("stop")).toHaveLength(2);
    expect(curve?.getAttribute("fill")).toBe(`url(#${gradient?.getAttribute("id")})`);

    const text = svg.querySelector("text");
    expect(text?.textContent).toBe("The lantern in XPS");
    expect(text?.getAttribute("x")).toBe("10");
    expect(text?.getAttribute("y")).toBe("40");
    expect(text?.getAttribute("font-size")).toBe("24");
    const canvas = text?.closest("g");
    expect(canvas?.getAttribute("transform")).toBe("matrix(1 0 0 1 50 200)");
    expect(canvas?.getAttribute("opacity")).toBe("0.5");
    expect(canvas?.getAttribute("clip-path")).toMatch(/^url\(#/);
    expect(page.text).toContain("The lantern in XPS");

    const image = svg.querySelector("pattern image");
    expect(image?.getAttribute("href")).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(svg.querySelector("pattern")?.getAttribute("width")).toBe("200");
    const polyline = shapes.at(-1);
    expect(polyline?.getAttribute("d")).toBe("M10 500L110 500L110 600Z");
  });

  it("an .odttf font de-obfuscates by its GUID to a TrueType font", async () => {
    const obfuscated = obfuscate(fakeFont(), FONT_GUID);
    expect([...obfuscated.subarray(0, 4)]).not.toEqual([0, 1, 0, 0]);
    const font = deobfuscate(obfuscated, `/Resources/Fonts/${FONT_GUID}.odttf`);
    expect(new DataView(font.buffer, font.byteOffset).getUint32(0)).toBe(0x00010000);
    expect(font).toEqual(fakeFont());

    const book = await readXps(await readZip(xps()));
    const page = await book.page(0);
    expect(page.fonts).toHaveLength(1);
    const loaded = page.fonts[0]?.bytes ?? new Uint8Array(4);
    expect(new DataView(loaded.buffer, loaded.byteOffset).getUint32(0)).toBe(0x00010000);
    expect(svgOf(page.svg).querySelector("text")?.getAttribute("font-family")).toContain(
      page.fonts[0]?.family,
    );
    expect(await book.text(1)).toContain("The second page of the XPS");
  });
});

it("keeps scoped XPS hyperlinks clickable and resolves internal page targets", async () => {
  const { zip } = await import("./build/archive");
  const { openBook } = await import("../ui/open.js");
  const bytes = zip([
    [
      "book.fdseq",
      '<FixedDocumentSequence><DocumentReference Source="book.fdoc"/></FixedDocumentSequence>',
    ],
    [
      "book.fdoc",
      '<FixedDocument><PageContent Source="one.fpage" Width="100" Height="100"/><PageContent Source="two.fpage" Width="100" Height="100"/></FixedDocument>',
    ],
    [
      "one.fpage",
      '<FixedPage Width="100" Height="100"><Glyphs UnicodeString="Web" FixedPage.NavigateUri="https://example.com/"/><Glyphs UnicodeString="Next" FixedPage.NavigateUri="two.fpage"/><Glyphs UnicodeString="Bad" FixedPage.NavigateUri="javascript:alert(1)"/></FixedPage>',
    ],
    ["two.fpage", '<FixedPage Width="100" Height="100"/>'],
  ]);
  const book = await openBook(bytes, { name: "links.xps", path: "links.xps" });
  expect(book.kind).toBe("pages");
  if (book.kind !== "pages") return;
  const host = document.createElement("div");
  const go = vi.fn();
  const external = vi.fn();
  await book.paint(0, host, 1, { go, external });
  const links = host.querySelectorAll("[data-reader-link]");
  expect(links).toHaveLength(2);
  links[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(external).toHaveBeenCalledWith("https://example.com/");
  links[1]?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  expect(go).toHaveBeenCalledWith(1);
});
