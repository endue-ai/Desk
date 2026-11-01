import { describe, expect, it } from "vitest";
import { IW44Image } from "../../lib/djvu/iw44.js";
import { grey, INK, PAGES, photo, textPage } from "./build/images.mjs";
import { chunkOf, chunksOf, eagerPacer, fixture, psnr } from "./helpers";

// The photos are c44's encodings of photo(320, 240) (build/encode.sh): three BG44 chunks of
// 74, 15 and 10 slices. The book's first page is djvumake's compound of the mask page.

/** One layer decoded from every chunk called `id` in `file`. */
async function layer(file: string, id = "BG44", count = Number.POSITIVE_INFINITY) {
  const image = new IW44Image();
  for (const data of chunksOf(fixture(file), id).slice(0, count)) await image.decodeChunk(data);
  return image;
}

const source = photo(320, 240).rgb;
const greySource = (() => {
  const g = grey(photo(320, 240)).grey;
  const rgb = new Uint8Array(g.length * 3);
  for (let i = 0; i < g.length; i++) rgb.fill(g[i] ?? 0, i * 3, i * 3 + 3);
  return rgb;
})();

/** An RGB image `factor` times smaller, each pixel the mean of its box. */
function shrink(rgb: Uint8Array, width: number, height: number, factor: number) {
  const w = Math.ceil(width / factor);
  const h = Math.ceil(height / factor);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let yy = y * factor; yy < Math.min(height, (y + 1) * factor); yy++) {
          for (let xx = x * factor; xx < Math.min(width, (x + 1) * factor); xx++) {
            sum += rgb[(yy * width + xx) * 3 + c] ?? 0;
            n++;
          }
        }
        out[(y * w + x) * 3 + c] = Math.round(sum / n);
      }
    }
  }
  return out;
}

const SENTENCE = /^[A-Z][^\n]*\.$/;

describe("IW44 layers", () => {
  it("a c44 colour page decodes within a small error of the source image (PSNR above 30 dB at the encoder's last slice)", async () => {
    const image = await layer("photo.djvu");
    expect([image.width, image.height, image.color, image.slices]).toEqual([320, 240, true, 99]);
    const out = await image.render();
    expect([out.width, out.height, out.rgba.length]).toEqual([320, 240, 320 * 240 * 4]);
    expect(psnr(out.rgba, 4, source, 3, 320 * 240)).toBeGreaterThan(30);
    expect(out.rgba[3]).toBe(255);
  });

  it("a grey photo decodes to grey pixels close to its source", async () => {
    const image = await layer("photo-grey.djvu");
    expect(image.color).toBe(false);
    const out = await image.render();
    expect(psnr(out.rgba, 4, greySource, 3, 320 * 240)).toBeGreaterThan(30);
    for (let i = 0; i < out.rgba.length; i += 4) {
      if (out.rgba[i] !== out.rgba[i + 1] || out.rgba[i] !== out.rgba[i + 2])
        throw new Error("not grey");
    }
  });

  it("full-resolution chrominance (c44 -crcbfull) decodes closer than the default", async () => {
    const full = await (await layer("photo-full.djvu")).render();
    const normal = await (await layer("photo.djvu")).render();
    const fullDb = psnr(full.rgba, 4, source, 3, 320 * 240);
    expect(fullDb).toBeGreaterThan(30);
    expect(fullDb).toBeGreaterThan(psnr(normal.rgba, 4, source, 3, 320 * 240));
  });

  it("FORM:PM44 and FORM:BM44 decode exactly like the same data in BG44 chunks", async () => {
    const pm44 = await (await layer("photo.iw4", "PM44")).render();
    expect(pm44.rgba).toEqual((await (await layer("photo.djvu")).render()).rgba);
    const bm44 = await (await layer("photo-grey.iw4", "BM44")).render();
    expect(bm44.rgba).toEqual((await (await layer("photo-grey.djvu")).render()).rgba);
  });

  it("each chunk refines the image: the first alone is coarser but recognisable", async () => {
    const scores: number[] = [];
    for (const count of [1, 2, 3]) {
      const out = await (await layer("photo.djvu", "BG44", count)).render();
      scores.push(psnr(out.rgba, 4, source, 3, 320 * 240));
    }
    expect(scores[0]).toBeGreaterThan(25);
    expect(scores[0]).toBeLessThan(scores[1] ?? 0);
    expect(scores[1]).toBeLessThan(scores[2] ?? 0);
  });

  it("renders reduced images from the transform's coarser scales", async () => {
    const image = await layer("photo.djvu");
    const sizes = [];
    for (const subsample of [2, 4, 8, 16]) {
      const out = await image.render({ subsample });
      sizes.push([out.width, out.height]);
      if (subsample <= 4) {
        const small = shrink(source, 320, 240, subsample);
        expect(psnr(out.rgba, 4, small, 3, out.width * out.height)).toBeGreaterThan(30);
      }
    }
    expect(sizes).toEqual([
      [160, 120],
      [80, 60],
      [40, 30],
      [20, 15],
    ]);
    await expect(image.render({ subsample: 3 })).rejects.toThrow(SENTENCE);
  });

  it("decodes the compound page's background and foreground layers", async () => {
    const book = fixture("book.djvu");
    const background = new IW44Image();
    for (const data of chunksOf(book, "BG44").slice(0, 4)) await background.decodeChunk(data);
    const bg = await background.render();
    expect([bg.width, bg.height]).toEqual([200, 134]);
    // Away from the text, the background is the page's photo at a third of its size.
    const mask = textPage(PAGES.mask);
    const full = shrink(photo(600, 400, 8).rgb, 600, 400, 3);
    let sum = 0;
    let count = 0;
    for (let y = 0; y < bg.height; y++) {
      for (let x = 0; x < bg.width; x++) {
        let text = false;
        for (let yy = y * 3 - 6; yy < y * 3 + 9 && !text; yy++) {
          for (let xx = x * 3 - 6; xx < x * 3 + 9; xx++) {
            if (yy >= 0 && xx >= 0 && yy < 400 && xx < 600 && mask.bits[yy * 600 + xx]) text = true;
          }
        }
        if (text) continue;
        for (let c = 0; c < 3; c++) {
          const d =
            (bg.rgba[(y * bg.width + x) * 4 + c] ?? 0) - (full[(y * bg.width + x) * 3 + c] ?? 0);
          sum += d * d;
        }
        count++;
      }
    }
    expect(count).toBeGreaterThan(2000);
    expect(10 * Math.log10((255 * 255 * count * 3) / sum)).toBeGreaterThan(30);

    const foreground = new IW44Image();
    await foreground.decodeChunk(chunkOf(book, "FG44"));
    const fg = await foreground.render();
    expect([fg.width, fg.height]).toEqual([100, 67]);
    expect([...fg.rgba.subarray(0, 3)]).toEqual(INK);
  });
});

describe("damaged IW44 data", () => {
  const first = chunkOf(fixture("photo.djvu"), "BG44");
  const second = chunkOf(fixture("photo.djvu"), "BG44", 1);

  it("a cut chunk fails with a sentence", async () => {
    await expect(new IW44Image().decodeChunk(first.slice(0, 100))).rejects.toThrow(
      "An IW44 chunk ends before its slices do.",
    );
  });

  it("chunks out of order fail with a sentence", async () => {
    await expect(new IW44Image().decodeChunk(second)).rejects.toThrow(
      "The first IW44 chunk of this image is missing.",
    );
    const image = new IW44Image();
    await image.decodeChunk(first);
    await expect(image.decodeChunk(first)).rejects.toThrow(
      "IW44 chunk 1 arrived where chunk 2 was expected.",
    );
  });

  it("an impossible header fails with a sentence", async () => {
    const header = (edit: (bytes: Uint8Array) => void) => {
      const bytes = first.slice();
      edit(bytes);
      return new IW44Image().decodeChunk(bytes);
    };
    await expect(header((b) => b.fill(0, 4, 6))).rejects.toThrow("An IW44 image has no pixels.");
    await expect(header((b) => b.fill(0xff, 4, 8))).rejects.toThrow(
      "An IW44 image is too large to decode.",
    );
    await expect(header((b) => (b[2] = 0x02))).rejects.toThrow(
      "This IW44 image uses version 2, which is not supported.",
    );
    await expect(new IW44Image().decodeChunk(first.slice(0, 5))).rejects.toThrow(SENTENCE);
    await expect(new IW44Image().decodeChunk(first.slice(0, 1))).rejects.toThrow(SENTENCE);
    await expect(new IW44Image().render()).rejects.toThrow("An IW44 image has no data to render.");
  });

  it("flipped bytes decode to something or fail with a sentence, and never hang", async () => {
    for (const at of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const bytes = first.slice();
      const start = Math.floor(bytes.length * at);
      for (let i = start; i < start + 16 && i < bytes.length; i++)
        bytes[i] = (bytes[i] ?? 0) ^ 0xff;
      const image = new IW44Image();
      try {
        await image.decodeChunk(bytes);
        const out = await image.render();
        expect(out.rgba.length).toBe(out.width * out.height * 4);
      } catch (error) {
        expect((error as Error).message).toMatch(SENTENCE);
      }
    }
  });
});

describe("pacing", () => {
  it("rests while decoding and rendering, with the same result", async () => {
    const pace = eagerPacer();
    const image = new IW44Image();
    for (const data of chunksOf(fixture("photo.djvu"), "BG44")) await image.decodeChunk(data, pace);
    const out = await image.render({ pace });
    expect(pace.rests).toBeGreaterThan(10);
    expect(out.rgba).toEqual((await (await layer("photo.djvu")).render()).rgba);
  });

  it("stops with an AbortError once the signal fires", async () => {
    const controller = new AbortController();
    controller.abort();
    const pace = eagerPacer(controller.signal);
    await expect(
      new IW44Image().decodeChunk(chunkOf(fixture("photo.djvu"), "BG44"), pace),
    ).rejects.toMatchObject({ name: "AbortError" });
    const image = await layer("photo.djvu");
    await expect(image.render({ pace })).rejects.toMatchObject({ name: "AbortError" });
  });
});
