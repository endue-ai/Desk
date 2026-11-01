import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDjvu } from "../../lib/djvu/index.js";
import { COLOURS, INK, PAGES, pbm, photo, textPage } from "./build/images.mjs";
import { fixture, psnr } from "./helpers";
import { measureRender } from "./timing";

const source = (bytes: Uint8Array) => ({
  size: bytes.length,
  read: async (offset: number, length: number) =>
    bytes.subarray(Math.min(offset, bytes.length), Math.min(bytes.length, offset + length)),
});
const expected = JSON.parse(new TextDecoder().decode(fixture("expected.json"))) as {
  sharedMasks: string[];
};
const open = (name: string, options?: Parameters<typeof openDjvu>[1]) =>
  openDjvu(source(fixture(name)), options);

/** The share of `pixels` (indices) whose colour is within `tolerance` of `colour` on every channel. */
function near(rgba: Uint8Array, pixels: number[], colour: number[], tolerance: number) {
  let hits = 0;
  for (const i of pixels) {
    if ([0, 1, 2].every((c) => Math.abs((rgba[i * 4 + c] ?? 0) - (colour[c] ?? 0)) <= tolerance))
      hits++;
  }
  return hits / pixels.length;
}

/** The indices where a bitmap is black, and where it is white with no black neighbour within 2. */
function split(bits: Uint8Array, width: number, height: number) {
  const ink: number[] = [];
  const clear: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bits[y * width + x]) {
        ink.push(y * width + x);
        continue;
      }
      let close = false;
      for (let dy = -2; dy <= 2 && !close; dy++) {
        for (let dx = -2; dx <= 2 && !close; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          close = yy >= 0 && xx >= 0 && yy < height && xx < width && bits[yy * width + xx] === 1;
        }
      }
      if (!close) clear.push(y * width + x);
    }
  }
  return { ink, clear };
}

describe("a bundled document made with djvumake, cpaldjvu, djvm and djvused", () => {
  it("gives its title and page sizes, the third page turned a quarter", async () => {
    const doc = await open("book.djvu");
    expect(doc.title).toBe("A test book");
    expect(doc.note).toBeUndefined();
    expect(doc.pages.map(({ width, height, dpi }) => [width, height, dpi])).toEqual([
      [600, 400, 150],
      [480, 320, 150],
      [240, 320, 100],
    ]);
    expect(doc.pages[0]?.rotation).toBe(0);
    expect([90, 270]).toContain(doc.pages[2]?.rotation);
  });

  it("composes the compound page: its text in the foreground colour over the background", async () => {
    const doc = await open("book.djvu");
    const page = await doc.renderPage(0);
    expect([page.width, page.height]).toEqual([600, 400]);
    const mask = textPage(PAGES.mask);
    const { ink, clear } = split(mask.bits, 600, 400);
    expect(near(page.rgba, ink, INK, 40)).toBeGreaterThan(0.97);
    // Away from the text the page is the background photo, at a third of the resolution.
    const want = photo(600, 400, 8).rgb;
    const got = new Uint8Array(clear.length * 3);
    const ref = new Uint8Array(clear.length * 3);
    clear.forEach((i, k) => {
      got.set(page.rgba.subarray(i * 4, i * 4 + 3), k * 3);
      ref.set(want.subarray(i * 3, i * 3 + 3), k * 3);
    });
    expect(psnr(got, 3, ref, 3, clear.length)).toBeGreaterThan(24);
  });

  it("paints each shape of the JB2-colours page in its FGbz palette colour", async () => {
    const doc = await open("book.djvu");
    const page = await doc.renderPage(1);
    const text = textPage(PAGES.colours);
    const { ink, clear } = split(text.bits, 480, 320);
    const top = ink.filter((i) => i < 480 * 160);
    const bottom = ink.filter((i) => i >= 480 * 160);
    expect(near(page.rgba, top, COLOURS[0] ?? [], 8)).toBeGreaterThan(0.99);
    expect(near(page.rgba, bottom, COLOURS[1] ?? [], 8)).toBeGreaterThan(0.99);
    expect(near(page.rgba, clear, [255, 255, 255], 8)).toBeGreaterThan(0.99);
  });

  it("turns the photo page as its INFO says", async () => {
    const doc = await open("book.djvu");
    const page = await doc.renderPage(2);
    expect([page.width, page.height]).toEqual([240, 320]);
    const src = photo(320, 240).rgb;
    const turned = new Uint8Array(240 * 320 * 3);
    const clockwise = doc.pages[2]?.rotation === 90;
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 320; x++) {
        const [tx, ty] = clockwise ? [239 - y, x] : [y, 319 - x];
        turned.set(src.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3), (ty * 240 + tx) * 3);
      }
    }
    expect(psnr(page.rgba, 4, turned, 3, 240 * 320)).toBeGreaterThan(30);
  });

  it("answers the text djvused set, in reading order, and null for a page without any", async () => {
    const doc = await open("book.djvu");
    expect(await doc.pageText(0)).toBe("Hello pages\nsecond line");
    expect(await doc.pageText(1)).toBe("Grüße 한글\ncolours");
    expect(await doc.pageText(2)).toBeNull();
  });

  it("answers the outline from NAVM, links to pages resolved", async () => {
    const doc = await open("book.djvu");
    expect(await doc.outline()).toEqual([
      { title: "Cover", url: "#1", page: 0, children: [] },
      {
        title: "Chapter one",
        url: "#2",
        page: 1,
        children: [{ title: "A section", url: "#3", page: 2, children: [] }],
      },
      { title: "Elsewhere", url: "https://example.com/", page: null, children: [] },
    ]);
  });

  it("renders a smaller page for a thumbnail that looks like the full one shrunk", async () => {
    const doc = await open("book.djvu");
    const full = await doc.renderPage(0);
    const small = await doc.renderPage(0, { scale: 0.25 });
    expect([small.width, small.height]).toEqual([150, 100]);
    const shrunk = new Uint8Array(150 * 100 * 3);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 150; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++)
              sum += full.rgba[((y * 4 + dy) * 600 + x * 4 + dx) * 4 + c] ?? 0;
          }
          shrunk[(y * 150 + x) * 3 + c] = Math.round(sum / 16);
        }
      }
    }
    expect(psnr(small.rgba, 4, shrunk, 3, 150 * 100)).toBeGreaterThan(25);
  });
});

describe("other kinds of DjVu files", () => {
  it("renders a single bitonal page black on white, exactly", async () => {
    const doc = await open("bitonal.djvu");
    expect(doc.pages).toEqual([{ width: 640, height: 480, dpi: 150, rotation: 0 }]);
    expect(await doc.outline()).toEqual([]);
    expect(await doc.pageText(0)).toBeNull();
    const page = await doc.renderPage(0);
    const want = textPage(PAGES.bitonal).bits;
    let wrong = 0;
    for (let i = 0; i < want.length; i++) {
      const v = page.rgba[i * 4];
      if (v !== (want[i] ? 0 : 255) || page.rgba[i * 4 + 1] !== v || page.rgba[i * 4 + 3] !== 255)
        wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("opens a stand-alone IW44 photo (FORM:PM44)", async () => {
    const doc = await open("photo.iw4");
    expect(doc.pages).toEqual([{ width: 320, height: 240, dpi: 100, rotation: 0 }]);
    const page = await doc.renderPage(0);
    expect(psnr(page.rgba, 4, photo(320, 240).rgb, 3, 320 * 240)).toBeGreaterThan(30);
  });

  it("decodes pages that share a JB2 dictionary through INCL as DjVuLibre does", async () => {
    // minidjvu merges shapes a pixel apart, so the pages are held to ddjvu's own masks.
    const doc = await open("shared.djvu");
    expect(doc.pages.length).toBe(2);
    for (const [i, spec] of [PAGES.shared1, PAGES.shared2].entries()) {
      const page = await doc.renderPage(i);
      const bits = new Uint8Array(page.width * page.height);
      for (let k = 0; k < bits.length; k++) bits[k] = (page.rgba[k * 4] ?? 0) < 128 ? 1 : 0;
      const file = pbm({ width: page.width, height: page.height, bits });
      const pixels = file.subarray(`P4\n${page.width} ${page.height}\n`.length);
      expect(createHash("sha256").update(pixels).digest("hex")).toBe(expected.sharedMasks[i]);
      let off = 0;
      const want = textPage(spec).bits;
      for (let k = 0; k < want.length; k++) if (bits[k] !== want[k]) off++;
      expect(off).toBeLessThan(want.length / 1000);
    }
  });

  it("lists an indirect document's pages as missing and says so, until they are resolved", async () => {
    const doc = await open("indirect.djvu");
    expect(doc.pages.length).toBe(3);
    expect(doc.pages.every((p) => p.missing && p.width === 0)).toBe(true);
    expect(doc.note).toMatch(/3 of its 3 pages .*compound\.djvu/);
    await expect(doc.renderPage(1)).rejects.toThrow(/colours\.djvu.*\.$/);
    expect((await doc.outline()).length).toBe(3);

    const resolved = await open("indirect.djvu", {
      resolve: async (name) =>
        name === "colours.djvu" ? source(fixture("indirect-colours.djvu")) : null,
    });
    expect(resolved.pages[1]).toEqual({ width: 480, height: 320, dpi: 150, rotation: 0 });
    expect(resolved.pages[0]?.missing).toBe("compound.djvu");
    expect(resolved.note).toMatch(/2 of its 3 pages/);
    expect(await resolved.pageText(1)).toBe("Grüße 한글\ncolours");
    const page = await resolved.renderPage(1);
    expect([page.width, page.height]).toEqual([480, 320]);
  });
});

describe("damaged files and long work", () => {
  it("refuses a file that is not DjVu with a sentence", async () => {
    await expect(openDjvu(source(new TextEncoder().encode("hello, world!!!!")))).rejects.toThrow(
      /not a DjVu file.*\.$/,
    );
  });

  it("fails with a sentence when a page's data is damaged or cut short", async () => {
    const book = fixture("book.djvu");
    // A file cut inside a page's mask fails with a sentence; inside its background, the page
    // shows the chunks that arrived and says so. The pages after the cut are missing.
    for (const id of ["Sjbz", "BG44"]) {
      const cut = book.slice(0, findChunk(book, id) + 500);
      const doc = await openDjvu(source(cut));
      expect(doc.note).toMatch(/^The file is cut short: 2 of its 3 pages are missing\.$/);
      await expect(doc.renderPage(2)).rejects.toThrow(/cut short before it\.$/);
      if (id === "Sjbz") {
        await expect(doc.renderPage(0)).rejects.toThrow(/^The JB2 data is cut short\.$/);
        continue;
      }
      const partial = await doc.renderPage(0);
      expect([partial.width, partial.height]).toEqual([600, 400]);
      expect(partial.note).toMatch(/cut short.*\.$/);
    }
    const damaged = book.slice();
    const sjbz = findChunk(damaged, "Sjbz");
    for (let i = sjbz + 40; i < sjbz + 400; i++) damaged[i] = (damaged[i] ?? 0) ^ 0xa5;
    // DjVu has no checksums: damaged JB2 data either fails with a sentence or decodes to noise.
    const doc = await openDjvu(source(damaged));
    const outcome = await doc.renderPage(0).then(
      (page) => [page.width, page.height],
      (error: Error) => error.message,
    );
    if (typeof outcome === "string") expect(outcome).toMatch(/^The JB2 data .*\.$/);
    else expect(outcome).toEqual([600, 400]);
    await expect(doc.renderPage(5)).rejects.toThrow(/no page 6/);
    // A damaged directory is caught when the document opens.
    const directory = book.slice();
    const dirm = findChunk(directory, "DIRM");
    for (let i = dirm + 30; i < dirm + 60; i++) directory[i] = (directory[i] ?? 0) ^ 0x3c;
    await expect(openDjvu(source(directory))).rejects.toThrow(/\.$/);
  });

  it("stops with an AbortError when the signal fires, before or during a large page", async () => {
    const doc = await open("big.djvu");
    expect(doc.pages[0]).toMatchObject({ width: 2550, height: 3300, dpi: 300 });
    const early = new AbortController();
    early.abort();
    await expect(doc.renderPage(0, { signal: early.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    const late = new AbortController();
    let turns = 0;
    const timer = setInterval(() => {
      turns++;
      if (turns === 2) late.abort();
    }, 1);
    try {
      await expect(doc.renderPage(0, { signal: late.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      clearInterval(timer);
    }
  });

  it.each([0, 80])(
    "bounds uninterrupted work and yields on a 300 dpi page (scheduler delay %i ms)",
    async (delay) => {
      const doc = await open("big.djvu");
      const measured = await measureRender(() => doc.renderPage(0), { delay });
      expect([measured.result.width, measured.result.height]).toEqual([2550, 3300]);
      expect(measured.maximum).toBeLessThan(60);
      expect(measured.turns).toBeGreaterThan(1);
      expect(measured.yields).toBeGreaterThan(1);
      if (delay) expect(measured.waiting).toBeGreaterThanOrEqual(60);
    },
  );
});

/** Where the data of the first chunk called `id` starts. */
function findChunk(bytes: Uint8Array, id: string) {
  const want = [...id].map((c) => c.charCodeAt(0));
  for (let i = 0; i < bytes.length - 8; i++) {
    if (want.every((b, k) => bytes[i + k] === b)) return i + 8;
  }
  throw new Error(`no ${id}`);
}
