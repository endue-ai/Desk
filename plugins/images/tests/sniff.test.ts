import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sniff } from "../ui/sniff.js";
import { ascii, concat, fits, pngHeader, tiff, writer } from "./build";
import { disk, fixture, image, mount } from "./harness";

const at = (offset: number, bytes: Uint8Array, length = offset + bytes.length + 64) => {
  const out = new Uint8Array(length);
  out.set(bytes, offset);
  return out;
};
const ftyp = (major: string, ...compatible: string[]) =>
  concat(
    writer(false)
      .u32(16 + compatible.length * 4)
      .done(),
    ascii(`ftyp${major}`),
    new Uint8Array(4),
    ...compatible.map(ascii),
  );
const SVG = ascii(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
);

describe("sniff", () => {
  it("magic bytes beat the extension", () => {
    expect(sniff(fixture("exif.png"), "photo.jpg")).toBe("png");
    expect(sniff(fixture("exif.jpg"), "photo.png")).toBe("jpeg");
    expect(sniff(fixture("anim.gif"), "a.webp")).toBe("gif");
    expect(sniff(fixture("exif.webp"), "a.gif")).toBe("webp");
    expect(sniff(fixture("rgba.qoi"), "a.tga")).toBe("qoi");
    expect(sniff(fixture("rgba.dds"), "a.png")).toBe("dds");
    expect(sniff(fixture("rgbe.hdr"), "a.exr")).toBe("hdr");
    expect(sniff(fixture("zip16-half.exr"), "a.hdr")).toBe("exr");
    expect(sniff(fixture("png.icns"), "a.ico")).toBe("icns");
    expect(sniff(fixture("p7.pam"), "a.ppm")).toBe("netpbm");
  });

  it("knows each format by its first bytes", () => {
    expect(sniff(fixture("exif.avif"), "x")).toBe("avif");
    expect(sniff(fixture("exif.heic"), "x")).toBe("heic");
    expect(sniff(ftyp("mif1", "mif1", "heic"), "x")).toBe("heic");
    expect(sniff(ftyp("mif1", "mif1", "avif"), "x")).toBe("avif");
    expect(sniff(new Uint8Array([0xff, 0x0a, 0, 0]), "x")).toBe("jxl");
    expect(
      sniff(
        concat(writer(false).u32(12).done(), ascii("JXL \r\n"), new Uint8Array([0x87, 0x0a])),
        "x",
      ),
    ).toBe("jxl");
    expect(sniff(concat(ascii("BM"), new Uint8Array(60)), "x")).toBe("bmp");
    expect(sniff(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]), "x")).toBe("ico");
    expect(sniff(new Uint8Array([0, 0, 2, 0, 1, 0, 16, 16]), "x")).toBe("cur");
    expect(sniff(tiff([[0x100, 3, [4]]]), "scan.tif")).toBe("tiff");
    expect(sniff(SVG, "x")).toBe("svg");
    expect(sniff(gzipSync(SVG), "drawing.svgz")).toBe("svgz");
    expect(sniff(ascii("%!PS-Adobe-3.0 EPSF-3.0\n"), "x")).toBe("eps");
    expect(sniff(new Uint8Array([0xc5, 0xd0, 0xd3, 0xc6, 0, 0, 0, 0]), "x")).toBe("eps");
    expect(sniff(new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0]), "x")).toBe("wmf");
    expect(sniff(concat(writer().u32(1).u32(108).done(), at(32, ascii(" EMF"), 60)), "x")).toBe(
      "emf",
    );
    expect(sniff(at(128, ascii("DICM")), "x")).toBe("dicom");
    expect(sniff(fits(1, 1, [0]), "x")).toBe("fits");
    expect(sniff(concat(writer().u32(348).done(), at(340, ascii("n+1\0"), 352)), "x")).toBe(
      "nifti",
    );
    expect(
      sniff(
        concat(new Uint8Array([0xab]), ascii("KTX 11"), new Uint8Array([0xbb, 13, 10, 26, 10])),
        "x",
      ),
    ).toBe("ktx");
  });

  it("camera RAW files are told apart from plain TIFF", () => {
    const tif = tiff([[0x100, 3, [4]]]);
    for (const name of [
      "a.dng",
      "a.nef",
      "a.nrw",
      "a.arw",
      "a.srf",
      "a.sr2",
      "a.pef",
      "a.srw",
      "a.3fr",
      "a.erf",
      "a.kdc",
    ])
      expect(sniff(tif, name), name).toBe("raw");
    expect(sniff(concat(ascii("II*\0"), writer().u32(16).done(), ascii("CR\x02\0")), "x")).toBe(
      "raw",
    );
    expect(sniff(ascii("FUJIFILMCCD-RAW 0201"), "x")).toBe("raw");
    expect(sniff(ftyp("crx ", "crx ", "isom"), "x")).toBe("raw");
    expect(sniff(ascii("IIRO\x08\0\0\0"), "x")).toBe("raw");
    expect(sniff(ascii("IIU\0\x08\0\0\0"), "x")).toBe("raw");
    expect(sniff(ascii("II\x1a\0\0\0HEAPCCDR"), "x")).toBe("raw");
    expect(sniff(ascii("\0MRM\0\0\0\0"), "x")).toBe("raw");
  });

  it("formats without magic bytes go by their extension; anything else is unknown", () => {
    expect(sniff(new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0]), "old.tga")).toBe("tga");
    expect(sniff(ascii("hello, this is text"), "notes.png")).toBe("unknown");
    expect(sniff(ascii("hello, this is text"), "notes.bin")).toBe("unknown");
    expect(sniff(new Uint8Array(), "empty.jpg")).toBe("unknown");
  });
});

describe("files images cannot show", () => {
  it("a PNG named .jpg opens as the PNG it is", async () => {
    const path = "~/Pictures/photo.jpg";
    const { host, view } = await mount({ handlers: disk({ [path]: pngHeader(7, 5) }) });
    await host.command("desk.files.visit", image(path));
    expect(view.states.at(-1)?.image).toMatchObject({
      name: "photo.jpg",
      format: "PNG",
      kind: "web",
      width: 7,
      height: 5,
    });
    expect(view.states.at(-1)?.image?.src).toMatch(/^data:image\/png;base64,/);
  });

  it("an unknown file opens as the details view: name, size, format and why", async () => {
    const path = "~/Pictures/notes.png";
    const bytes = ascii("hello, this is text and not an image\n");
    const { host, view } = await mount({ handlers: disk({ [path]: bytes }) });
    await expect(host.command("desk.files.visit", image(path))).resolves.toBeUndefined();
    const shown = view.states.at(-1)?.image;
    expect(shown).toMatchObject({
      name: "notes.png",
      size: bytes.length,
      format: "Unknown",
      kind: "details",
    });
    expect(shown?.reason).toBe("Its first bytes are not those of any image format Images reads.");
    expect(shown?.src).toBeUndefined();
    expect(shown?.details).toEqual(
      expect.arrayContaining([
        { label: "Format", value: "Unknown" },
        { label: "File size", value: "37 bytes" },
      ]),
    );
  });

  it("a damaged file opens as the details view with the decoder's reason", async () => {
    const path = "~/Pictures/cut.qoi";
    const bytes = fixture("rgba.qoi").subarray(0, 20);
    const { host, view } = await mount({ handlers: disk({ [path]: bytes }) });
    await host.command("desk.files.visit", image(path));
    const shown = view.states.at(-1)?.image;
    expect(shown).toMatchObject({ format: "QOI", kind: "details" });
    expect(shown?.reason).toMatch(/\.$/);
    expect(view.statuses).toEqual([]);
  });
});
