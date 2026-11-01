// EXIF from every container that carries it: JPEG APP1, PNG eXIf, WebP EXIF, the HEIC and AVIF Exif
// item, and TIFF-based RAW. The fixtures carry made-up values (make-fixtures.py) and orientation 6.
import { describe, expect, it } from "vitest";
import { decode } from "../ui/decode.js";
import { tiff } from "./containers";
import { fixture } from "./harness";

const FIELDS = {
  Camera: "Example Camera 1",
  Lens: "Example Lens 35mm F2.8",
  "Exposure time": "1/250 s",
  Aperture: "f/2.8",
  ISO: "400",
  "Focal length": "35 mm",
  "Date taken": "2026-10-31 12:34:56",
  "GPS position": "37.56665° N, 126.97800° E",
  Software: "fixture-maker 1.0",
};

const fieldsOf = (exif: { fields: Array<{ label: string; value: string }> } | undefined) =>
  Object.fromEntries((exif?.fields ?? []).map((f) => [f.label, f.value]));

describe("EXIF", () => {
  // libavif moves the orientation into AVIF's irot and leaves EXIF at 1; HEIF's transforms decide.
  for (const [name, format, stored] of [
    ["exif.jpg", "JPEG", 6],
    ["exif.png", "PNG", 6],
    ["exif.webp", "WebP", 6],
    ["exif.heic", "HEIC", 6],
    ["exif.avif", "AVIF", 1],
  ] as const)
    it(`reads the fields and the orientation from ${format}`, async () => {
      const result = await decode(fixture(name), name);
      expect(result).toMatchObject({ kind: "web", format, width: 64, height: 48 });
      expect(fieldsOf(result.exif)).toEqual(FIELDS);
      expect(result.exif?.orientation).toBe(stored);
      // The stored pixels are 64 x 48; shown a quarter turn clockwise, they stand 48 wide.
      expect(result.orientation).toBe(6);
    });

  it("reads a TIFF-based RAW's IFD0, EXIF and GPS IFDs, south and west too", async () => {
    const bytes = tiff(
      [
        [0x10f, 2, "SONY"],
        [0x110, 2, "ILCE-0"],
        [0x112, 3, [3]],
        [0x131, 2, "ILCE-0 v1.00"],
        [0x8769, 4, [0]],
        [0x8825, 4, [1]],
      ],
      {
        subIfds: [
          [
            [0x829a, 5, [2, 1]],
            [0x829d, 5, [8, 1]],
            [0x8827, 3, [100]],
            [0x9003, 2, "2026:01:02 03:04:05"],
            [0x920a, 5, [50, 1]],
            [0xa405, 3, [75]],
          ],
          [
            [0x0001, 2, "S"],
            [0x0002, 5, [33, 1, 52, 1, 768, 100]],
            [0x0003, 2, "W"],
            [0x0004, 5, [151, 1, 12, 1, 3348, 100]],
          ],
        ],
      },
    );
    const result = await decode(bytes, "DSC00001.ARW");
    expect(result.exif?.orientation).toBe(3);
    expect(fieldsOf(result.exif)).toEqual({
      Camera: "SONY ILCE-0",
      "Exposure time": "2 s",
      Aperture: "f/8",
      ISO: "100",
      "Focal length": "50 mm (75 mm in 35 mm film)",
      "Date taken": "2026-01-02 03:04:05",
      "GPS position": "33.86880° S, 151.20930° W",
      Software: "ILCE-0 v1.00",
    });
  });

  it("a file without EXIF has none, and is shown as stored", async () => {
    const result = await decode(fixture("small.jpg"), "small.jpg");
    expect(result.exif).toBeUndefined();
    expect(result.orientation).toBe(1);
  });
});
