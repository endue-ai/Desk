// The file is read through the SDK's byteSource (#180) and its cache of 64 KiB blocks. Reads that
// run at once (the library worker's, a preview's, an extraction's) must each get their own bytes,
// also when the cache drops blocks one of them still needs.
import { describe, expect, it } from "vitest";
import { byteSource } from "../../../packages/plugin-sdk/src/index";
import { createFiles } from "../ui/files.js";
import { noise } from "./fixtures";

const PATH = "~/Downloads/big.img";
const BYTES = noise(12 << 20, 7);

/** A bridge with no fs.url, answering ranged fs.read calls from BYTES after a turn. */
const bridge = {
  call: async (method: string, params: { offset?: number; length?: number }) => {
    if (method !== "fs.read") throw Object.assign(new Error(method), { code: "unsupported" });
    await new Promise((done) => setTimeout(done, Math.random() * 3));
    const offset = params.offset ?? 0;
    const part = BYTES.subarray(offset, offset + (params.length ?? 0));
    return {
      content: Buffer.from(part).toString("base64"),
      encoding: "base64",
      size: BYTES.length,
    };
  },
};

describe("ranged reads through byteSource", () => {
  it("answers many reads at once with their own bytes", async () => {
    const files = createFiles(bridge as never, byteSource as never);
    const { source } = await files.open(PATH);
    let seed = 11;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let round = 0; round < 4; round++) {
      const asks = Array.from({ length: 24 }, () => {
        const offset = next() % (BYTES.length - (2 << 20));
        const length = 1 + (next() % ((2 << 20) - (64 << 10)));
        return { offset, length };
      });
      const got = await Promise.all(asks.map(({ offset, length }) => source.read(offset, length)));
      got.forEach((bytes, i) => {
        const { offset, length } = asks[i] as { offset: number; length: number };
        expect(Buffer.compare(bytes, BYTES.subarray(offset, offset + length)), `read ${i}`).toBe(0);
      });
    }
  });
});
