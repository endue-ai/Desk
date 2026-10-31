import { describe, expect, it } from "vitest";
import { bzz } from "../../lib/djvu/bzz.js";
import { ZPDecoder } from "../../lib/djvu/zp.js";
import { sampleBytes, sampleText } from "./build/images.mjs";
import { fixture } from "./helpers";

// The streams are DjVuLibre's `bzz -e` output (build/encode.sh) for the generated text and bytes.
const text = new TextEncoder().encode(sampleText(30000));
const bytes = sampleBytes(24000);

describe("the Z'-coder", () => {
  it("reads a BZZ stream's block size in pass-through mode", () => {
    const zp = new ZPDecoder(fixture("text.bzz"));
    let n = 1;
    while (n < 1 << 24) n = (n << 1) | zp.passthrough();
    expect(n - (1 << 24)).toBe(text.length + 1); // the block and its end marker
  });

  it("decodes context bits, adapting each context on its own", () => {
    // The first symbols of the text's Burrows-Wheeler block, decoded by hand through contexts.
    const zp = new ZPDecoder(fixture("text.bzz"));
    for (let i = 0; i < 26; i++) zp.passthrough();
    const contexts = new Uint8Array(262);
    const first = zp.decode(contexts, 2);
    expect(first).toBe(0);
    expect(contexts[2]).not.toBe(0);
    expect(contexts[3]).toBe(0);
  });

  it("reads 1 bits past the end of its data and counts them", () => {
    const zp = new ZPDecoder(new Uint8Array([0x00, 0x00]));
    for (let i = 0; i < 64; i++) zp.passthrough();
    expect(zp.past).toBeGreaterThan(0);
  });
});

describe("BZZ", () => {
  it("decodes a one-block stream made by bzz to its bytes", () => {
    expect(bzz(fixture("text.bzz"))).toEqual(text);
  });

  it("decodes a stream of 10 KB blocks made by bzz -e10 to its bytes", () => {
    expect(bzz(fixture("text-blocks.bzz"))).toEqual(text);
  });

  it("decodes binary data spread over the whole move-to-front table", () => {
    expect(bzz(fixture("bytes.bzz"))).toEqual(bytes);
  });

  it("stops early once a limit is reached", () => {
    const out = bzz(fixture("text-blocks.bzz"), 100);
    expect(out.length).toBeGreaterThanOrEqual(100);
    expect(out.length).toBeLessThan(text.length);
    expect(out).toEqual(text.subarray(0, out.length));
  });

  it("fails with a sentence on damaged data instead of returning garbage", () => {
    const damaged = fixture("text.bzz").slice();
    for (let i = 200; i < 260; i++) damaged[i] = (damaged[i] ?? 0) ^ 0x5a;
    expect(() => bzz(damaged)).toThrow(/BZZ .*\.$/);
    for (const length of [10, 1000, 3000]) {
      expect(() => bzz(fixture("text.bzz").subarray(0, length))).toThrow(/BZZ .*\.$/);
    }
  });

  it("answers nothing for an empty stream, as bzz writes an empty file", () => {
    expect(bzz(new Uint8Array(0)).length).toBe(0);
  });
});
