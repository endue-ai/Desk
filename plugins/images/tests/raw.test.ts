// Camera RAW files show their largest embedded JPEG preview. The containers are built here around
// two real JPEGs (make-fixtures.py): a 16 x 12 thumbnail and a 64 x 48 preview.
import { describe, expect, it } from "vitest";
import { decode } from "../ui/decode.js";
import { ascii, concat, writer } from "./build";
import { cr3, raf, tiff, withApp1 } from "./containers";
import { fixture } from "./harness";

const SMALL = fixture("small.jpg");
const LARGE = fixture("large.jpg");

/** Bytes that look like nothing: sensor data, with a stray JPEG start in it. */
const sensor = (length: number) => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 73 + 41) % 251;
  out.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11], 100);
  return out;
};

/** A lossless JPEG (SOF3), as DNG and CR2 store sensor data: larger, but no webview decodes it. */
const lossless = concat(
  new Uint8Array([0xff, 0xd8, 0xff, 0xc3, 0x00, 0x0b, 0x10]),
  writer(false).u16(3000).u16(4000).done(),
  new Uint8Array([
    0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]),
  sensor(200),
  new Uint8Array([0xff, 0xd9]),
);

async function preview(bytes: Uint8Array, name: string) {
  const result = await decode(bytes, name);
  expect(result, result.reason).toMatchObject({
    kind: "web",
    mime: "image/jpeg",
    label: "Embedded preview",
  });
  return result;
}

describe("embedded previews", () => {
  it("finds the largest JPEG among a TIFF-based RAW's IFDs and SubIFDs (NEF)", async () => {
    const bytes = tiff(
      [
        [0x0fe, 4, [1]],
        [0x10f, 2, "NIKON CORPORATION"],
        [0x110, 2, "Example D1"],
        [0x112, 3, [8]],
        [0x14a, 4, [0, 1]],
        [0x201, 4, { blob: "thumb" }],
        [0x202, 4, { blob: "thumb" }],
      ],
      {
        subIfds: [
          [
            [0x103, 3, [6]],
            [0x201, 4, { blob: "preview" }],
            [0x202, 4, { blob: "preview" }],
          ],
          [
            [0x100, 4, [6000]],
            [0x101, 4, [4000]],
            [0x103, 3, [34713]],
            [0x111, 4, { blob: "sensor" }],
            [0x117, 4, { blob: "sensor" }],
          ],
        ],
        blobs: { thumb: SMALL, preview: LARGE, sensor: sensor(4096) },
      },
    );
    const result = await preview(bytes, "DSC_0001.nef");
    expect(result).toMatchObject({ format: "RAW (NEF)", width: 64, height: 48, orientation: 8 });
    expect(result.data).toEqual(LARGE);
  });

  it("skips lossless JPEG sensor data, as a DNG keeps it, for the largest one a webview shows", async () => {
    const bytes = tiff(
      [
        [0x0fe, 4, [1]],
        [0x103, 3, [7]],
        [0x111, 4, { blob: "preview" }],
        [0x117, 4, { blob: "preview" }],
        [0x14a, 4, [0]],
      ],
      {
        subIfds: [
          [
            [0x0fe, 4, [0]],
            [0x103, 3, [7]],
            [0x111, 4, { blob: "raw" }],
            [0x117, 4, { blob: "raw" }],
          ],
        ],
        blobs: { preview: LARGE, raw: lossless },
      },
    );
    const result = await preview(bytes, "IMG_0001.dng");
    expect(result.data).toEqual(LARGE);
  });

  it("finds the CR3's PRVW preview, larger than its THMB", async () => {
    const cmt1 = tiff([
      [0x10f, 2, "Canon"],
      [0x110, 2, "Canon EOS Example"],
      [0x112, 3, [6]],
    ]);
    const result = await preview(cr3(cmt1, SMALL, LARGE, sensor(2048)), "IMG_0001.CR3");
    expect(result).toMatchObject({ format: "RAW (CR3)", width: 64, height: 48, orientation: 6 });
    expect(result.data).toEqual(LARGE);
    expect(result.exif?.fields).toContainEqual({ label: "Camera", value: "Canon EOS Example" });
  });

  it("finds the JPEG a RAF's header points to, not the thumbnail inside its EXIF", async () => {
    const thumbnailExif = concat(
      ascii("Exif\0\0"),
      tiff([[0x10f, 2, "FUJIFILM"]], {
        ifd1: [
          [0x201, 4, { blob: "thumb" }],
          [0x202, 4, { blob: "thumb" }],
        ],
        blobs: { thumb: SMALL },
      }),
    );
    const jpeg = withApp1(LARGE, thumbnailExif);
    const result = await preview(raf(jpeg, sensor(4096)), "DSCF0001.RAF");
    expect(result).toMatchObject({ format: "RAW (RAF)", width: 64, height: 48 });
    expect(result.data).toEqual(jpeg);
  });

  it("prefers a colour JPEG to a larger one-channel JPEG of sensor data (CRW)", async () => {
    const crw = concat(ascii("II\x1a\0\0\0HEAPCCDR"), sensor(256), fixture("grey.jpg"), SMALL);
    const result = await preview(crw, "CRW_0001.CRW");
    expect(result).toMatchObject({ width: 16, height: 12 });
    expect(result.data).toEqual(SMALL);
  });

  it("shows an uncompressed RGB thumbnail when there is no JPEG (DNG, 3FR, ERF)", async () => {
    const rgb = Uint8Array.from({ length: 4 * 2 * 3 }, (_, i) => i * 10);
    const bytes = tiff(
      [
        [0x100, 3, [4]],
        [0x101, 3, [2]],
        [0x102, 3, [8, 8, 8]],
        [0x103, 3, [1]],
        [0x106, 3, [2]],
        [0x111, 4, { blob: "rgb" }],
        [0x115, 3, [3]],
        [0x117, 4, { blob: "rgb" }],
      ],
      { blobs: { rgb } },
    );
    const result = await decode(bytes, "L1000001.DNG");
    expect(result).toMatchObject({
      kind: "pixels",
      label: "Embedded preview",
      width: 4,
      height: 2,
    });
    const expected = Array.from({ length: 8 }, (_, p) => [
      p * 30,
      p * 30 + 10,
      p * 30 + 20,
      255,
    ]).flat();
    expect(Array.from(result.rgba ?? [])).toEqual(expected);
  });

  it("a RAW without a preview opens as the details view", async () => {
    const bytes = tiff([
      [0x100, 4, [6000]],
      [0x101, 4, [4000]],
      [0x103, 3, [34713]],
    ]);
    const result = await decode(bytes, "DSC_0002.nef");
    expect(result).toMatchObject({ kind: "details", format: "RAW (NEF)" });
    expect(result.reason).toBe("It carries no embedded preview that Images can show.");
  });
});
