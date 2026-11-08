import { describe, expect, it } from "vitest";
import { decodeJB2, maskOf } from "../../lib/djvu/jb2.js";
import { pacer } from "../../lib/djvu/pace.js";
import { COLOURS, PAGES, textPage } from "./build/images.mjs";
import { chunkOf, eagerPacer, fixture } from "./helpers";

type Bitmap = { width: number; height: number; bits: Uint8Array };

/** How many pixels differ (both bitmaps the same size). */
function differing(a: Bitmap, b: Bitmap) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let count = 0;
  for (let i = 0; i < a.bits.length; i++) if (a.bits[i] !== b.bits[i]) count++;
  return count;
}

const sjbz = (file: string, index = 0) => chunkOf(fixture(file), "Sjbz", index);
const SENTENCE = /^The JB2 data [^\n]*\.$/;

describe("JB2 masks", () => {
  it("a cjb2 bitonal page decodes to the expected bitmap (exact, compared with the source PBM)", async () => {
    const image = await decodeJB2(sjbz("bitonal.djvu"));
    expect([image.width, image.height]).toEqual([PAGES.bitonal.width, PAGES.bitonal.height]);
    expect(image.blits.length).toBeGreaterThan(800);
    expect(differing(maskOf(image), textPage(PAGES.bitonal))).toBe(0);
  });

  it("a cjb2 -lossy page (copies and refinements of near matches) stays within 1% of the source", async () => {
    const image = await decodeJB2(sjbz("bitonal-lossy.djvu"));
    const source = textPage(PAGES.bitonal);
    const black = source.bits.reduce((n, b) => n + b, 0);
    expect(differing(maskOf(image), source)).toBeLessThan(black * 0.01);
  });

  it("minidjvu pages decode through their shared Djbz dictionary", async () => {
    const shared = fixture("shared.djvu");
    const dictionary = await decodeJB2(chunkOf(shared, "Djbz"));
    expect([dictionary.width, dictionary.height, dictionary.blits.length]).toEqual([0, 0, 0]);
    expect(dictionary.library.length).toBeGreaterThan(20);
    for (const [i, page] of [PAGES.shared1, PAGES.shared2].entries()) {
      const image = await decodeJB2(chunkOf(shared, "Sjbz", i), { dictionary });
      // minidjvu substitutes shapes a pixel apart, so the page is not the source to the pixel;
      // DjVuLibre's own ddjvu renders exactly these pixels.
      expect(differing(maskOf(image), textPage(page))).toBeLessThan(60);
    }
  });

  it("cpaldjvu's mask is exact and has one blit per FGbz colour index", async () => {
    const book = fixture("book.djvu");
    const image = await decodeJB2(chunkOf(book, "Sjbz", 1));
    expect(differing(maskOf(image), textPage(PAGES.colours))).toBe(0);
    const fgbz = chunkOf(book, "FGbz");
    const colours = ((fgbz[1] ?? 0) << 8) | (fgbz[2] ?? 0);
    expect(colours).toBeGreaterThanOrEqual(COLOURS.length);
    const at = 3 + colours * 3;
    expect(image.blits.length).toBe(
      ((fgbz[at] ?? 0) << 16) | ((fgbz[at + 1] ?? 0) << 8) | (fgbz[at + 2] ?? 0),
    );
  });

  it("maskOf clips blits that lie partly outside the image", () => {
    const shape = { width: 3, height: 2, bits: new Uint8Array([1, 1, 1, 1, 1, 1]) };
    const image = {
      width: 4,
      height: 3,
      shapes: [shape],
      library: [],
      blits: [
        { shape: 0, left: -1, top: -1 },
        { shape: 0, left: 3, top: 2 },
      ],
    };
    expect([...maskOf(image).bits]).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
});

describe("damaged JB2 data", () => {
  it("flipped bytes mid-stream reject with a sentence", async () => {
    const bytes = sjbz("bitonal.djvu").slice();
    const at = Math.floor(bytes.length / 2);
    for (let i = at; i < at + 16; i++) bytes[i] = (bytes[i] ?? 0) ^ 0xff;
    await expect(decodeJB2(bytes)).rejects.toThrow(SENTENCE);
  });

  it("a cut stream rejects as cut short", async () => {
    const bytes = sjbz("bitonal.djvu");
    await expect(decodeJB2(bytes.subarray(0, bytes.length >> 1))).rejects.toThrow(
      "The JB2 data is cut short.",
    );
  });

  it("a page whose dictionary is missing or too small rejects with a sentence", async () => {
    const shared = fixture("shared.djvu");
    const page = chunkOf(shared, "Sjbz");
    const sentence = "The JB2 data needs a shape dictionary that is missing or too small.";
    await expect(decodeJB2(page)).rejects.toThrow(sentence);
    const dictionary = await decodeJB2(chunkOf(shared, "Djbz"));
    const short = { ...dictionary, library: dictionary.library.slice(0, 3) };
    await expect(decodeJB2(page, { dictionary: short })).rejects.toThrow(sentence);
  });
});

describe("pacing", () => {
  it("yields to the event loop while decoding and still decodes the same page", async () => {
    const pace = eagerPacer();
    const image = await decodeJB2(sjbz("bitonal.djvu"), { pace });
    expect(pace.rests).toBeGreaterThan(100);
    expect(differing(maskOf(image), textPage(PAGES.bitonal))).toBe(0);
  });

  it("an aborted signal rejects with an AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      decodeJB2(sjbz("bitonal.djvu"), { pace: pacer(controller.signal) }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    const late = new AbortController();
    const pace = eagerPacer(late.signal);
    const decoding = decodeJB2(sjbz("bitonal.djvu"), { pace });
    late.abort();
    await expect(decoding).rejects.toMatchObject({ name: "AbortError" });
  });
});
