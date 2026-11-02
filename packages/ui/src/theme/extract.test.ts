import { describe, expect, it } from "vitest";
import { extractColors, type Pixels } from "./index";

type Rgba = [number, number, number, number];
const hex = (c: string): Rgba => [
  Number.parseInt(c.slice(1, 3), 16),
  Number.parseInt(c.slice(3, 5), 16),
  Number.parseInt(c.slice(5, 7), 16),
  255,
];

/** An image painted pixel by pixel. */
function image(width: number, height: number, paint: (x: number, y: number) => Rgba): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return { width, height, data };
}

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  255,
];

// Four flat blocks, as stripes covering 45%, 30%, 15% and 10% of a 400 × 300 image, as a saved logo
// has them: a soft edge (a six-pixel gradient) between blocks and a little noise on every block.
// Thousands of different pixels, so it is downsampled and clustered, not counted.
const BLOCKS = ["#f7f3e8", "#1d2a44", "#e4572e", "#2e9e8f"];
const EDGES = [0, 180, 300, 360, 400];
const blocks = image(400, 300, (x, y) => {
  const at = EDGES.findIndex((edge, i) => x >= edge && x < (EDGES[i + 1] ?? 400));
  const own = hex(BLOCKS[at] ?? "#000000");
  const next = EDGES[at + 1] ?? 400;
  if (at < 3 && x >= next - 6)
    return mix(own, hex(BLOCKS[at + 1] ?? "#000000"), (x - next + 7) / 7);
  const noise = [0, 2, 0, -2][(((x * 73856093) ^ (y * 19349663)) >>> 0) % 4] ?? 0;
  return [own[0] + noise, own[1], own[2], 255];
});

describe("extractColors", () => {
  it("gives the colours of four flat blocks, ordered by how much of the image they cover", () => {
    const swatches = extractColors(blocks);
    expect(swatches.length).toBeLessThanOrEqual(5);
    expect(swatches.slice(0, 4).map((s) => s.color)).toEqual(BLOCKS);
    const shares = swatches.slice(0, 4).map((s) => s.share);
    for (const [i, share] of [0.45, 0.3, 0.15, 0.1].entries())
      expect(shares[i]).toBeCloseTo(share, 1);
    // Shares are of the counted pixels and add up to the whole.
    expect(swatches.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 5);
  });

  it("returns five colours of a busy image, each a colour of the image", () => {
    const palette = ["#f7f3e8", "#1d2a44", "#e4572e", "#2e9e8f", "#f2c14e", "#8e5bd0", "#d0d0d0"];
    let state = 7;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const busy = image(160, 120, () =>
      hex(palette[Math.floor(random() * palette.length)] ?? "#000000"),
    );
    const swatches = extractColors(busy);
    expect(swatches).toHaveLength(5);
    for (const s of swatches) expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
    for (let i = 1; i < swatches.length; i++)
      expect(swatches[i]?.share ?? 0).toBeLessThanOrEqual(swatches[i - 1]?.share ?? 0);
  });

  it("ignores near-transparent pixels", () => {
    // A green that is all but invisible covers most of the image; the logo is navy and orange.
    const logo = image(100, 100, (x, y) => {
      if (x < 70) return [0, 255, 0, y % 2 === 0 ? 0 : 20];
      return x < 90 ? hex("#1d2a44") : hex("#e4572e");
    });
    const swatches = extractColors(logo);
    expect(swatches.map((s) => s.color)).toEqual(["#1d2a44", "#e4572e"]);
    expect(swatches[0]?.share).toBeCloseTo(2 / 3, 2);
    expect(extractColors(image(10, 10, () => [255, 0, 0, 0]))).toEqual([]);
  });

  it("gives the same colours for the same pixels, every time", () => {
    let state = 99;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return Math.floor((state / 2147483648) * 256);
    };
    const noise = image(300, 200, () => [random(), random(), random(), 255]);
    const first = extractColors(noise);
    expect(first).toHaveLength(5);
    expect(extractColors(noise)).toEqual(first);
    expect(extractColors({ ...noise, data: Uint8Array.from(noise.data) })).toEqual(first);
  });
});
