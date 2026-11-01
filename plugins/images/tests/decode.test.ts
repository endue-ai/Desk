// Each of the plugin's own decoders turns a small fixture into RGBA pixels. Fixtures from real tools
// (make-fixtures.py) are compared with the pattern they were drawn from, or, when the format is lossy
// or float, with the tool's own decode next to them (.rgba, .f32); the rest are built in build.ts.
import { describe, expect, it } from "vitest";
import { decode } from "../ui/decode.js";
import { toneMap } from "../ui/formats/tonemap.js";
import { dicom16, fits, icnsRleEntry, ktx1, nifti, pattern, plainPnm, rgba, tga16 } from "./build";
import { fixture } from "./harness";

const W = 8;
const H = 4;
const PATTERN = rgba(W, H, pattern);
const OPAQUE = rgba(W, H, (x, y) => [...pattern(x, y).slice(0, 3), 255]);
const f32 = (name: string) => {
  const b = fixture(name);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};

/** Decode a fixture (or bytes) and return its pixels, failing with the reason when it did not. */
async function pixels(bytes: Uint8Array, name: string) {
  const result = await decode(bytes, name);
  if (result.kind !== "pixels" || !result.rgba)
    throw new Error(`${name}: ${result.kind} ${result.reason ?? ""}`);
  return { ...result, rgba: result.rgba };
}
const px = async (name: string) => Uint8Array.from((await pixels(fixture(name), name)).rgba);

/** Every byte within `tolerance` of the expected one. */
function near(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance: number) {
  expect(actual.length).toBe(expected.length);
  const off = Array.from(actual).findIndex((v, i) => Math.abs(v - (expected[i] ?? 0)) > tolerance);
  expect(off, `byte ${off}: ${actual[off]} vs ${expected[off]}`).toBe(-1);
}

describe("TGA", () => {
  it("reads raw 24-bit and RLE 32-bit, bottom-up as Pillow writes them", async () => {
    expect(await px("raw24.tga")).toEqual(OPAQUE);
    expect(await px("rle32.tga")).toEqual(PATTERN);
  });

  it("reads colour-mapped RLE, greyscale and 16-bit files", async () => {
    expect(await px("mapped.tga")).toEqual(fixture("mapped.tga.rgba"));
    expect(await px("grey.tga")).toEqual(fixture("grey.tga.rgba"));
    const five = (v: number) => (v << 3) | (v >> 2);
    const value = (x: number, y: number) => ((x + y) % 2 ? 0x8000 : 0) | (x << 10) | (y << 5) | 31;
    const result = await pixels(tga16(3, 2, value), "a.tga");
    expect(result.rgba).toEqual(
      new Uint8ClampedArray(rgba(3, 2, (x, y) => [five(x), five(y), 255, (x + y) % 2 ? 255 : 0])),
    );
  });
});

describe("Netpbm", () => {
  it("reads the plain P1, P2 and P3", async () => {
    const p1 = await pixels(plainPnm(1, 3, 2, [1, 0, 1, 0, 1, 0]), "a.pbm");
    const bw = (v: number) => (v ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    expect(p1.rgba).toEqual(new Uint8ClampedArray(rgba(3, 2, (x, y) => bw((x + y + 1) % 2))));
    const p2 = await pixels(plainPnm(2, 2, 2, [0, 5, 10, 15], 15), "a.pgm");
    const grey = [0, 85, 170, 255];
    expect(p2.rgba).toEqual(
      new Uint8ClampedArray(rgba(2, 2, (x, y) => [...Array(3).fill(grey[y * 2 + x]), 255])),
    );
    const p3 = await pixels(plainPnm(3, 2, 1, [255, 0, 0, 0, 128, 255]), "a.ppm");
    expect(p3.rgba).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 255]));
  });

  it("reads the binary P4, P5 (8 and 16 bit), P6 and P7", async () => {
    expect(await px("p4.pbm")).toEqual(fixture("p4.pbm.rgba"));
    expect(await px("p5.pgm")).toEqual(fixture("p5.pgm.rgba"));
    expect(await px("p5-16.pgm")).toEqual(fixture("p5.pgm.rgba"));
    expect(await px("p6.ppm")).toEqual(OPAQUE);
    expect(await px("p7.pam")).toEqual(PATTERN);
  });
});

describe("QOI and DDS", () => {
  it("reads QOI", async () => {
    expect(await px("rgba.qoi")).toEqual(PATTERN);
  });

  it("reads uncompressed DDS and BC1, BC2 and BC3, with and without a DX10 header", async () => {
    expect(await px("rgba.dds")).toEqual(PATTERN);
    for (const name of ["bc1.dds", "bc2.dds", "bc3.dds", "bc3-dx10.dds"])
      near(await px(name), fixture(`${name}.rgba`), 1);
  });
});

describe("HDR and OpenEXR", () => {
  it("tone-maps: values up to 1 are only sRGB-encoded", () => {
    const out = toneMap(new Float32Array([0, 0.5, 1, 1, 0.2, 0.2, 0.2, 0.5]), 2);
    expect(Array.from(out)).toEqual([0, 188, 255, 255, 124, 124, 124, 128]);
  });

  it("reads Radiance RGBE (RLE), as ffmpeg decodes it, and tone-maps it", async () => {
    const result = await pixels(fixture("rgbe.hdr"), "a.hdr");
    const expected = f32("rgbe.hdr.f32");
    near(
      Array.from(result.float ?? [], (v) => v * 1000),
      Array.from(expected, (v) => v * 1000),
      1,
    );
    near(result.rgba, toneMap(expected, W * H), 1);
  });

  for (const compression of ["none", "rle", "zip1", "zip16"])
    for (const kind of ["half", "float"])
      it(`reads scanline EXR, ${compression} compression, ${kind} channels`, async () => {
        const name = `${compression}-${kind}.exr`;
        const result = await pixels(fixture(name), name);
        expect(Array.from(result.float ?? [])).toEqual(Array.from(f32(`${name}.f32`)));
        near(result.rgba, toneMap(f32(`${name}.f32`), W * H), 1);
      });
});

describe("ICNS and KTX", () => {
  it("reads the RLE it32 entry with its t8mk mask", async () => {
    const pixel = (x: number, y: number) => [x * 2, y * 2, (x + y) % 256, x < 64 ? 255 : 0];
    const result = await pixels(icnsRleEntry("it32", 128, pixel), "app.icns");
    expect([result.width, result.height]).toEqual([128, 128]);
    expect(result.rgba).toEqual(new Uint8ClampedArray(rgba(128, 128, pixel)));
  });

  it("shows the largest PNG entry through the webview", async () => {
    // Pillow writes every size up to ic10 (512 pt at 2x), so the largest entry is 1024 pixels.
    const result = await decode(fixture("png.icns"), "png.icns");
    expect(result).toMatchObject({ kind: "web", mime: "image/png", width: 1024, height: 1024 });
  });

  it("reads KTX 1 holding uncompressed RGBA8", async () => {
    const result = await pixels(ktx1(W, H, PATTERN), "a.ktx");
    expect(result.rgba).toEqual(new Uint8ClampedArray(PATTERN));
  });
});

describe("DICOM, FITS and NIfTI", () => {
  it("reads 16-bit DICOM through its rescale and window", async () => {
    // Stored values -> Hounsfield units (intercept -1024): -1000, 40, 600, 0; window 40 / 400.
    const result = await pixels(dicom16(4, 1, [24, 1064, 1624, 1024]), "a.dcm");
    expect(result.rgba).toEqual(
      new Uint8ClampedArray([
        0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 102, 102, 102, 255,
      ]),
    );
  });

  it("reads FITS BITPIX -32, min-max stretched, top row first, blank where NaN", async () => {
    const result = await pixels(fits(3, 2, [0, 1, 2, 3, Number.NaN, 5]), "a.fits");
    const grey = (v: number) => [v, v, v, 255];
    expect(Array.from(result.rgba)).toEqual([
      ...grey(153),
      0,
      0,
      0,
      0,
      ...grey(255),
      ...grey(0),
      ...grey(51),
      ...grey(102),
    ]);
  });

  it("reads NIfTI-1: the middle axial slice, and the others on request", async () => {
    const voxel = (x: number, y: number, z: number) => z * 100 + y * 10 + x;
    const result = await pixels(nifti(4, 3, 5, voxel), "head.nii");
    const slice = (z: number) =>
      new Uint8ClampedArray(
        rgba(4, 3, (x, y) => {
          const v = Math.round((voxel(x, 2 - y, z) / 423) * 255);
          return [v, v, v, 255];
        }),
      );
    expect(result.slices).toMatchObject({ index: 2, count: 5 });
    expect(result.rgba).toEqual(slice(2));
    expect(result.slices?.at(4)).toEqual(slice(4));
  });
});
