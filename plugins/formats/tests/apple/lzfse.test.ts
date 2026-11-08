import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V1_HEADER } from "../../lib/apple/fse.js";
import { decodeLzfse, lzfseBlocks } from "../../lib/apple/lzfse.js";
import { decodeLzvn } from "../../lib/apple/lzvn.js";

// The streams make-fixtures.py wrote: LZFSE from compression_tool, raw LZVN from libcompression's
// own encoder (algorithm 0x900, as decmpfs keeps it).
const dir = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const streams = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")).streams as Record<
  string,
  { size: number; sha256: string }
>;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const original = (name: string) => streams[name] ?? { size: -1, sha256: "" };
const magics = (bytes: Uint8Array) => lzfseBlocks(bytes).map((b) => b.magic);

/** A sentence error of the stream's own, never a RangeError, a TypeError or a hang. */
const SENTENCE = /^The (LZFSE|LZVN) stream (is damaged: .+\.|ends early\.)$/;

/** A bvx1 block (the v1 header: every field whole) holding the bvx2 block at `index`, then bvx$. */
function asV1(stream: Uint8Array, index: number) {
  const block = lzfseBlocks(stream)[index];
  const h = block?.header;
  if (!block || !h) throw new Error("no compressed block there");
  const head = new DataView(new ArrayBuffer(V1_HEADER));
  const words = [0x31787662, h.rawBytes, block.length, h.literals, h.matches, h.literalPayload];
  words.push(h.lmdPayload, h.literalBits);
  for (const [i, value] of words.entries()) head.setInt32(4 * i, value, true);
  for (const [i, state] of h.literalStates.entries()) head.setUint16(32 + 2 * i, state, true);
  head.setInt32(40, h.lmdBits, true);
  for (const [i, state] of [h.lState, h.mState, h.dState].entries())
    head.setUint16(44 + 2 * i, state, true);
  for (const [i, f] of h.freq.entries()) head.setUint16(50 + 2 * i, f, true);
  const payload = stream.subarray(block.payload, block.payload + block.length);
  const out = new Uint8Array(V1_HEADER + payload.length + 4);
  out.set(new Uint8Array(head.buffer));
  out.set(payload, V1_HEADER);
  out.set(new TextEncoder().encode("bvx$"), V1_HEADER + payload.length);
  return { stream: out, raw: h.rawBytes };
}

describe("LZFSE", () => {
  const CASES = [
    ["text.lzfse", ["bvx2", "bvx2", "bvx$"]],
    ["small.lzfse", ["bvxn", "bvx$"]],
    ["noise.lzfse", ["bvx-", "bvx$"]],
    ["empty.lzfse", ["bvx-", "bvx$"]],
  ] as const;
  for (const [name, blocks] of CASES) {
    it(`decodes ${name} (${blocks.join(", ")}) to the exact original bytes`, () => {
      const stream = fixture(name);
      expect(magics(stream)).toEqual(blocks);
      const want = original(name);
      for (const out of [decodeLzfse(stream), decodeLzfse(stream, want.size)]) {
        expect(out.length).toBe(want.size);
        expect(sha256(out)).toBe(want.sha256);
      }
    });
  }

  it("decodes a bvx1 block, the header with its tables whole", () => {
    const text = fixture("text.lzfse");
    const v1 = asV1(text, 0);
    expect(magics(v1.stream)).toEqual(["bvx1", "bvx$"]);
    expect(decodeLzfse(v1.stream)).toEqual(decodeLzfse(text).subarray(0, v1.raw));
  });

  it("stops at the size asked for, and answers what a shorter stream holds", () => {
    const text = fixture("text.lzfse");
    const whole = decodeLzfse(text);
    for (const size of [1, 4096, 83195, 100_000]) {
      expect(decodeLzfse(text, size)).toEqual(whole.subarray(0, size));
    }
    // Asked for more than there is: the decoded bytes, no more.
    expect(decodeLzfse(text, whole.length + 10).length).toBe(whole.length);
    // The blocks past the size asked for are not even looked at.
    const first = lzfseBlocks(text)[1]?.at ?? 0;
    expect(decodeLzfse(text.subarray(0, first + 2), 83195)).toEqual(whole.subarray(0, 83195));
  });

  it("refuses a stream that is cut short or has no end marker", () => {
    const text = fixture("text.lzfse");
    for (const cut of [0, 3, 20, 1000, text.length - 4, text.length - 1]) {
      expect(() => decodeLzfse(text.subarray(0, cut)), `cut at ${cut}`).toThrow(
        "The LZFSE stream ends early.",
      );
    }
  });

  it("refuses damaged headers with a sentence", () => {
    const text = fixture("text.lzfse");
    const unknown = text.slice();
    unknown[3] = 0x39; // "bvx9"
    expect(() => decodeLzfse(unknown)).toThrow(
      "The LZFSE stream is damaged: a block has an unknown magic number.",
    );
    const states = text.slice();
    states[8 + 16 + 7] = 0xff; // d_state and the unused top bits of the third packed word
    expect(() => decodeLzfse(states)).toThrow(/^The LZFSE stream is damaged: /);
    const freq = text.slice();
    freq.fill(0xff, 32, 40); // the frequency code then runs past the header's end
    expect(() => decodeLzfse(freq)).toThrow(/^The LZFSE stream is damaged: /);
  });

  it("fails damaged payloads with a sentence or decodes them, never anything else", () => {
    const text = fixture("text.lzfse");
    const first = lzfseBlocks(text)[0];
    const start = (first?.payload ?? 0) + 1;
    let seed = 185;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    let refused = 0;
    for (let round = 0; round < 300; round++) {
      const copy = text.slice();
      for (let n = 0; n < 4; n++) {
        const at = start + (next() % (copy.length - start - 4));
        copy[at] = (copy[at] ?? 0) ^ (1 + (next() % 255));
      }
      try {
        decodeLzfse(copy);
      } catch (error) {
        expect((error as Error).message).toMatch(SENTENCE);
        refused++;
      }
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe("LZVN", () => {
  for (const name of ["text.lzvn", "small.lzvn"]) {
    it(`decodes ${name} to the exact original bytes, with and without its size`, () => {
      const stream = fixture(name);
      const want = original(name);
      for (const out of [decodeLzvn(stream), decodeLzvn(stream, want.size)]) {
        expect(out.length).toBe(want.size);
        expect(sha256(out)).toBe(want.sha256);
      }
    });
  }

  it("ends at the end-of-stream opcode, and stops at the size asked for", () => {
    const text = fixture("text.lzvn");
    expect(Array.from(text.subarray(-8))).toEqual([6, 0, 0, 0, 0, 0, 0, 0]);
    const whole = decodeLzvn(text);
    // Whatever follows the end-of-stream opcode is not read.
    const padded = new Uint8Array(text.length + 16).fill(0xd0);
    padded.set(text);
    expect(decodeLzvn(padded)).toEqual(whole);
    for (const size of [1, 7, 1000, 4096, 65_535]) {
      expect(decodeLzvn(text, size)).toEqual(whole.subarray(0, size));
    }
    // A stream without its end-of-stream opcode ends with its input.
    expect(decodeLzvn(text.subarray(0, text.length - 8))).toEqual(whole);
  });

  it("refuses a stream cut inside an opcode, a match before the start and undefined opcodes", () => {
    const text = fixture("text.lzvn");
    expect(() => decodeLzvn(text.subarray(0, 5))).toThrow("The LZVN stream ends early.");
    expect(() => decodeLzvn(text.subarray(0, text.length - 4))).toThrow(
      "The LZVN stream ends early.",
    );
    // A small-distance match of 3 bytes, 1 back, with nothing decoded yet.
    expect(() => decodeLzvn(Uint8Array.of(0x00, 0x01))).toThrow(
      "The LZVN stream is damaged: a match reaches before the start.",
    );
    // A literal, then a previous-distance match (with one more literal) before any distance.
    expect(() => decodeLzvn(Uint8Array.of(0xe1, 0x41, 0x46, 0x42))).toThrow(
      "The LZVN stream is damaged: a match reaches before the start.",
    );
    for (const op of [0x1e, 0x70, 0xd5])
      expect(() => decodeLzvn(Uint8Array.of(op, 0, 0, 0))).toThrow(
        `The LZVN stream is damaged: opcode 0x${op.toString(16)} is not defined.`,
      );
  });

  it("fails damaged streams with a sentence or decodes them, never anything else", () => {
    const text = fixture("text.lzvn");
    let seed = 1185;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 300; round++) {
      const copy = text.slice();
      const at = next() % copy.length;
      copy[at] = (copy[at] ?? 0) ^ (1 + (next() % 255));
      try {
        decodeLzvn(copy, round % 2 ? 65_536 : 0);
      } catch (error) {
        expect((error as Error).message).toMatch(SENTENCE);
      }
    }
  });
});
