// The decoders the pack readers bring with them: LZO1X against streams liblzo2 wrote, XPRESS
// Huffman and LZX against Microsoft's own examples and a chunk wimlib wrote, and all three against
// streams from the test encoders; damaged streams fail fast.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lzo1x } from "../../lib/packs/lzo.js";
import { lzxWim } from "../../lib/packs/lzx.js";
import { xpressHuffman } from "../../lib/packs/xpress.js";
import { e8Translate, lzx, xpress, xpressTokens } from "./ms-encoders";
import { lzo1x as lzoEncode } from "./pack-encoders";
import { code, mixed, noise, random, text } from "./samples";

const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/), (h) => Number.parseInt(h, 16));
/** A 256-byte XPRESS table from its nonzero runs, then the bit stream. */
function vector(runs: Record<number, string>, tail: string) {
  const table = new Uint8Array(256);
  for (const [at, bytes] of Object.entries(runs)) table.set(hex(bytes), Number(at));
  return new Uint8Array([...table, ...hex(tail)]);
}
/** Flip one bit of the byte at `at`. */
const flip = (b: Uint8Array, at: number, next: () => number) => {
  b[at] = (b[at] ?? 0) ^ (1 << Math.floor(next() * 8));
};
const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const lzoDir = join(import.meta.dirname, "fixtures", "lzo");
const lzoFixture = (name: string) => new Uint8Array(readFileSync(join(lzoDir, name)));

/** Run `decode` on damaged input: it fails with the sentence (or decodes), and fast. */
function failsFast(decode: () => Uint8Array, sentence: RegExp) {
  const start = performance.now();
  expect(decode).toThrow(sentence);
  expect(performance.now() - start).toBeLessThan(1000);
}

describe("LZO", () => {
  const expected = JSON.parse(readFileSync(join(lzoDir, "expected.json"), "utf8")) as Record<
    string,
    { size: number; sha256: string }
  >;
  it.each(Object.keys(expected).flatMap((name) => [`${name}-1`, `${name}-999`]))(
    "decodes %s, which liblzo2 wrote, exactly",
    (file) => {
      const want = expected[file.replace(/-\d+$/, "")] ?? { size: -1, sha256: "" };
      const out = lzo1x(lzoFixture(`${file}.lzo`), want.size);
      expect([out.length, sha256(out)]).toEqual([want.size, want.sha256]);
    },
  );

  it("decodes every instruction form", () => {
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const decode = (bytes: number[], max = 4096) =>
      new TextDecoder().decode(lzo1x(Uint8Array.from(bytes), max));
    // First-byte literals, then the end marker.
    expect(decode([17 + 3, ...ascii("abc"), 0x11, 0, 0])).toBe("abc");
    // Two literals, then M1: two bytes from two back.
    expect(decode([17 + 2, ...ascii("ab"), 0x04, 0, 0x11, 0, 0])).toBe("abab");
    // Four literals, M2 (four bytes, four back) with one literal in its low bits.
    expect(decode([17 + 4, ...ascii("abcd"), 0x6d, 0, ...ascii("x"), 0x11, 0, 0])).toBe(
      "abcdabcdx",
    );
    // A long literal run with a length byte, then M3 with a length byte.
    const run = "0123456789abcdefghijklm";
    expect(decode([0, 5, ...ascii(run), 32, 7, 0, 0, 0x11, 0, 0])).toBe(run + "m".repeat(40));
  });

  it.each([
    ["text", text(65536)],
    ["noise", noise(5000)],
    ["matches at every distance", mixed(120000, 49000)],
    ["x86 code", code(30000)],
    ["a run", new Uint8Array(70000).fill(9)],
    [
      "short repeats after short literals",
      new TextEncoder().encode(`xyabab${"q".repeat(3000)}zz xyabab`),
    ],
    ["two bytes", Uint8Array.of(1, 2)],
    ["nothing", new Uint8Array(0)],
  ])("decodes %s from the test encoder exactly", (_, data) => {
    expect(sha1(lzo1x(lzoEncode(data), data.length))).toBe(sha1(data));
  });

  it("fails fast on damaged streams", () => {
    const data = text(30000);
    const packed = lzoEncode(data);
    failsFast(() => lzo1x(packed.subarray(0, 1000), data.length), /^The LZO data is damaged: /);
    failsFast(() => lzo1x(packed, 1000), /decodes to more than a block/);
    failsFast(() => lzo1x(Uint8Array.of(18, 97, 0x20 | 5, 0x10, 0), 100), /reaches back before/);
    failsFast(
      () => lzo1x(Uint8Array.of(18, 97, 0x11, 0, 0, 0), 100),
      /data follows the end marker/,
    );
    const next = random(13);
    for (let round = 0; round < 50; round++) {
      const bad = packed.slice();
      for (let k = 0; k < 4; k++) flip(bad, Math.floor(next() * bad.length), next);
      const start = performance.now();
      try {
        expect(lzo1x(bad, data.length).length).toBeLessThanOrEqual(data.length);
      } catch (error) {
        expect(String(error)).toMatch(/The LZO data is damaged: /);
      }
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});

describe("XPRESS", () => {
  it("decodes the two examples of [MS-XCA] section 3.2", () => {
    const alphabet = vector(
      { 48: "50 55 55 55 55 55 55 55 55 55 55 45 44 04", 128: "04" },
      "d8 52 3e d7 94 11 5b e9 19 5f f9 d6 7c df 8d 04 00 00 00 00",
    );
    expect(new TextDecoder().decode(xpressHuffman(alphabet, 26))).toBe(
      "abcdefghijklmnopqrstuvwxyz",
    );
    const abc = vector({ 48: "30 23", 128: "02", 143: "20" }, "a8 dc 00 00 ff 26 01");
    expect(new TextDecoder().decode(xpressHuffman(abc, 300))).toBe("abc".repeat(100));
  });

  it.each([
    ["text", text(65536)],
    ["noise", noise(4096)],
    ["a long run", new Uint8Array(40000).fill(7)],
    ["matches at every distance", mixed(65536, 65535)],
    ["one byte", Uint8Array.of(42)],
  ])("decodes %s exactly", (_, data) => {
    expect(sha1(xpressHuffman(xpress(data), data.length))).toBe(sha1(data));
  });

  it("reads match lengths in one, three and seven bytes", () => {
    for (const len of [17, 18, 200, 272, 273, 5000, 69999]) {
      const packed = xpressTokens([{ lit: 97 }, { len, off: 1 }]);
      expect(xpressHuffman(packed, len + 1)).toEqual(new Uint8Array(len + 1).fill(97));
    }
  });

  it("fails fast on damaged streams", () => {
    const data = text(30000);
    const packed = xpress(data);
    failsFast(
      () => xpressHuffman(packed.subarray(0, 200), data.length),
      /^The XPRESS data is damaged: the data ends before its Huffman table\.$/,
    );
    failsFast(
      () => xpressHuffman(packed.subarray(0, packed.length >> 1), data.length),
      /^The XPRESS data is damaged: /,
    );
    failsFast(() => xpressHuffman(new Uint8Array(300).fill(0x11), 10), /do not form a prefix code/);
    failsFast(
      () => xpressHuffman(xpressTokens([{ len: 5, off: 3 }]), 5),
      /reaches back before the data/,
    );
    const next = random(9);
    for (let round = 0; round < 50; round++) {
      const bad = packed.slice();
      for (let k = 0; k < 4; k++) flip(bad, 256 + Math.floor(next() * (bad.length - 256)), next);
      const start = performance.now();
      try {
        expect(xpressHuffman(bad, data.length).length).toBe(data.length);
      } catch (error) {
        expect(String(error)).toMatch(/The XPRESS data is damaged: /);
      }
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});

describe("LZX", () => {
  it("decodes a chunk wimlib wrote: the metadata of the sample WIM's first image", () => {
    const wim = new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "sample.wim")));
    expect(sha1(lzxWim(wim.subarray(280, 280 + 178), 376))).toBe(
      "7c21d36f030255fdcc03c6f7c5ddf7920174452e",
    );
  });

  it.each([
    ["verbatim blocks", ["verbatim"], 32768],
    ["aligned offset blocks", ["aligned"], 32768],
    ["an uncompressed block", ["uncompressed"], 32768],
    ["several blocks of each kind", ["verbatim", "aligned", "uncompressed", "aligned"], 3001],
    ["odd-sized uncompressed blocks between compressed ones", ["uncompressed", "verbatim"], 777],
  ] as const)("decodes %s exactly", (_, kinds, blockBytes) => {
    const data = mixed(32768);
    const packed = lzx(data, { kinds: [...kinds], blockBytes });
    expect(sha1(lzxWim(packed, data.length))).toBe(sha1(data));
  });

  it("undoes the E8 call translation in x86 code", () => {
    const data = code(32768);
    expect(e8Translate(data)).not.toEqual(data);
    for (const kinds of [["verbatim"], ["uncompressed"]] as const) {
      const packed = lzx(data, { kinds: [...kinds] });
      expect(sha1(lzxWim(packed, data.length))).toBe(sha1(data));
    }
    const short = Uint8Array.of(0xe8, 1, 0, 0, 0, 0xe8, 2, 0, 0, 0);
    expect(lzxWim(lzx(short), short.length)).toEqual(short);
  });

  it("reads matches of 257 bytes, repeated offsets and noise", () => {
    const data = new Uint8Array(19800);
    const pattern = text(64);
    for (let at = 0; at < data.length; at += 600) {
      data.fill(0x61, at, at + 300);
      data.set(pattern, at + 300);
      data.set(noise(20, at), at + 364);
      data.set(pattern.subarray(0, 40), at + 384);
    }
    expect(sha1(lzxWim(lzx(data, { kinds: ["aligned"] }), data.length))).toBe(sha1(data));
  });

  it("decodes larger windows, whose block sizes take 24 bits", () => {
    for (const window of [65536, 1 << 18]) {
      const data = mixed(window, window - 3, 7);
      const packed = lzx(data, { window, kinds: ["verbatim", "aligned"], blockBytes: 40000 });
      expect(sha1(lzxWim(packed, data.length, window))).toBe(sha1(data));
    }
  });

  it("fails fast on damaged streams", () => {
    const data = mixed(32768);
    const packed = lzx(data, { kinds: ["aligned"] });
    failsFast(
      () => lzxWim(packed.subarray(0, packed.length >> 1), data.length),
      /^The LZX data is damaged: /,
    );
    failsFast(() => lzxWim(Uint8Array.of(0, 0x10, 0, 0), 100), /a block has the unknown type 0/);
    failsFast(() => lzxWim(packed, 40000), /window size is out of range/);
    const next = random(11);
    for (let round = 0; round < 50; round++) {
      const bad = packed.slice();
      for (let k = 0; k < 4; k++) flip(bad, Math.floor(next() * bad.length), next);
      const start = performance.now();
      try {
        expect(lzxWim(bad, data.length).length).toBe(data.length);
      } catch (error) {
        expect(String(error)).toMatch(/The LZX data is damaged: /);
      }
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});
