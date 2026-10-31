import { describe, expect, it } from "vitest";
import { decode } from "../ui/codecs/index.js";
import { expected, fixture, sha256 } from "./fixtures";

// Every fixture is the same 210 KB of generated text, written by the real tool named.
const STREAMS = [
  ["text.bz2", "bzip2", "bzip2 -1: three 100 KB blocks"],
  ["text.lzma", "lzma", "lzma (LZMA alone, end marker)"],
  ["text.xz", "xz", "xz --block-size=64KiB: LZMA2 in four blocks, CRC64"],
  ["text-crc32.xz", "xz", "xz -e --check=crc32"],
  ["text.zst", "zstd", "zstd -19: Huffman literals, FSE sequences, a checksum"],
  ["text-long.zst", "zstd", "zstd -19 --long=27 --no-check"],
  ["text-fast.zst", "zstd", "zstd -1"],
  ["text.lz4", "lz4", "lz4 -9 -B4 -BD: linked blocks, a content checksum"],
  ["text-blocks.lz4", "lz4", "lz4 -B4 -BX --content-size: block checksums"],
  ["text.Z", "lzw", "compress: LZW up to 16 bits, block mode"],
] as const;

/** A copy of the stream with `count` bytes from `at` (a fraction of its length) inverted. */
function damaged(bytes: Uint8Array, at: number, count = 16) {
  const copy = bytes.slice();
  const start = Math.floor(copy.length * at);
  for (let i = start; i < start + count; i++) copy[i] = (copy[i] ?? 0) ^ 0xff;
  return copy;
}

describe("the plugin's own decoders", () => {
  for (const [file, codec, what] of STREAMS) {
    it(`${codec} decodes ${file} (${what}) to the exact original bytes`, async () => {
      const out = await decode(codec, fixture(file));
      expect(out.length).toBe(expected.text.size);
      expect(sha256(out)).toBe(expected.text.sha256);
    });
  }

  it("gzip decodes through DecompressionStream", async () => {
    const out = await decode("gzip", fixture("hello.txt.gz"));
    expect(new TextDecoder().decode(out)).toBe("Hello, archives!\n");
  });

  for (const [file, codec] of STREAMS) {
    it(`a damaged ${file} fails with a sentence, not a hang`, async () => {
      const started = Date.now();
      // compress has no checksum: damage it early, where codes still point past the table's end.
      const at = codec === "lzw" ? 0.02 : 0.5;
      const error = await decode(codec, damaged(fixture(file), at)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^[A-Z][^\n]*\.$/);
      expect(Date.now() - started).toBeLessThan(4000);
    });
  }

  it("a stream cut short says it ends early", async () => {
    // A .Z file has no end marker or length, so a short one cannot be told from a whole one.
    for (const [file, codec] of STREAMS.filter(([, codec]) => codec !== "lzw")) {
      const bytes = fixture(file);
      await expect(decode(codec, bytes.subarray(0, bytes.length >> 1))).rejects.toThrow(
        /ends early|ends before|incomplete/i,
      );
    }
  });

  it("xz checks each block's CRC64 and zstd its frame checksum", async () => {
    const xz = fixture("text.xz");
    // The stream footer's backward size gives the index; the last block's CRC64 sits right before it.
    const footer = new DataView(xz.buffer, xz.byteOffset + xz.length - 12, 12);
    const index = xz.length - 12 - (footer.getUint32(4, true) + 1) * 4;
    expect(xz[index]).toBe(0);
    const badCheck = xz.slice();
    for (let i = index - 8; i < index; i++) badCheck[i] = (badCheck[i] ?? 0) ^ 0x55;
    await expect(decode("xz", badCheck)).rejects.toThrow(/check/i);

    const zst = fixture("text.zst");
    const badSum = zst.slice();
    badSum[badSum.length - 1] = (badSum[badSum.length - 1] ?? 0) ^ 0xff;
    await expect(decode("zstd", badSum)).rejects.toThrow(/checksum/i);
  });

  it("an unknown codec is refused in words", async () => {
    await expect(decode("brotli", new Uint8Array(4))).rejects.toThrow("No decoder for brotli.");
  });
});
