import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";
import { crc32, ROOT, render, TILES } from "./theme-textures.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's chunks in order, each one's CRC checked. */
function chunks(png) {
  assert.deepEqual(png.subarray(0, 8), SIGNATURE, "PNG signature");
  const out = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const crc = png.readUInt32BE(at + 8 + length);
    assert.equal(crc, crc32(png.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

/** What a PNG draws, whatever zlib version packed it: header, palette, transparency and pixels. */
function picture(png) {
  const list = chunks(png);
  const of = (type) => Buffer.concat(list.filter((c) => c.type === type).map((c) => c.data));
  return {
    header: of("IHDR"),
    palette: of("PLTE"),
    alpha: of("tRNS"),
    pixels: inflateSync(of("IDAT")),
  };
}

describe("theme-textures", () => {
  it("computes CRC-32 as PNG does", () => {
    assert.equal(crc32(Buffer.from("IEND", "latin1")), 0xae426082);
  });

  it("renders the same bytes twice", () => {
    const [a, b] = [render(), render()];
    assert.deepEqual(
      [...a.keys()],
      TILES.map((t) => t.file),
    );
    for (const [file, png] of a) assert.ok(png.equals(b.get(file)), `${file} differs`);
  });

  it("renders valid, small PNG tiles: IHDR first, IEND last, whole scanlines", () => {
    for (const [file, png] of render()) {
      const list = chunks(png);
      assert.equal(list[0].type, "IHDR", file);
      assert.equal(list.at(-1).type, "IEND", file);
      const header = list[0].data;
      const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
      const [depth, colorType] = [header[8], header[9]];
      assert.ok(width >= 2 && width <= 512 && height >= 2 && height <= 512, `${file} size`);
      assert.deepEqual([header[10], header[11], header[12]], [0, 0, 0], `${file} methods`);
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
      assert.ok(channels, `${file} colour type ${colorType}`);
      const row = 1 + Math.ceil((width * depth * channels) / 8);
      assert.equal(picture(png).pixels.length, height * row, `${file} scanlines`);
      assert.ok(png.length <= 64 * 1024, `${file} is ${png.length} bytes`);
    }
  });

  it("the committed tiles draw what the generator draws (node scripts/theme-textures.mjs)", () => {
    for (const [file, png] of render()) {
      assert.deepEqual(picture(readFileSync(join(ROOT, file))), picture(png), `${file} is stale`);
    }
  });

  it("gives Paper a paper tile and Amber scanlines in both schemes, the files their themes name", () => {
    for (const [folder, name] of [
      ["theme-paper", "paper"],
      ["theme-amber", "scanlines"],
    ]) {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, "plugins", folder, "plugin.json"), "utf8"),
      );
      for (const scheme of ["light", "dark"]) {
        const image = `images/${name}-${scheme}.png`;
        assert.ok(
          TILES.some((t) => t.file === `plugins/${folder}/${image}`),
          `${folder} ${scheme}`,
        );
        assert.equal(manifest.theme[scheme].backdrop.image, image);
      }
    }
  });
});
