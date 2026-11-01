// byteSource under concurrent reads (#262): each read keeps the blocks it needs, reads of one block
// share one request, and the cache keeps at most 64 blocks.
import type { FsReadPermission } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { byteSource, connect } from "./index";
import { createTestHost } from "./testing/index";

const SCOPE: FsReadPermission = { permission: "fs:read", paths: ["~/qa/**"] };
const FILE = { path: "~/qa/big.bin", scope: SCOPE };

function noise(length: number, seed: number) {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    bytes[i] = state >>> 16;
  }
  return bytes;
}

/** A plugin whose fs.url is refused, so byteSource reads with fs.read ranges, answered after a turn. */
async function plugin(bytes: Uint8Array, delay: () => number) {
  const reads: Array<{ offset: number; length: number }> = [];
  const host = createTestHost({
    pluginId: "test.byte-source-concurrent",
    grants: [SCOPE],
    handlers: {
      "fs.url": () => {
        throw Object.assign(new Error("no file URLs here"), { code: "unsupported" });
      },
      "fs.read": async (params: { offset?: number; length?: number }) => {
        const offset = params.offset ?? 0;
        const length = params.length ?? bytes.length;
        reads.push({ offset, length });
        await new Promise((done) => setTimeout(done, delay()));
        const part = bytes.subarray(offset, offset + length);
        return {
          content: Buffer.from(part).toString("base64"),
          encoding: "base64",
          size: bytes.length,
        };
      },
    } as never,
  });
  const ctx = await connect(host.transport);
  return { source: await byteSource(ctx, FILE), reads };
}

describe("byteSource concurrency", () => {
  it("answers many concurrent reads with their own bytes", async () => {
    const bytes = noise(12 << 20, 7);
    const { source } = await plugin(bytes, () => Math.random() * 3);
    let seed = 11;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let round = 0; round < 4; round++) {
      const asks = Array.from({ length: 24 }, () => {
        const offset = next() % (bytes.length - (2 << 20));
        const length = 1 + (next() % ((2 << 20) - (64 << 10)));
        return { offset, length };
      });
      const got = await Promise.all(asks.map(({ offset, length }) => source.read(offset, length)));
      got.forEach((part, i) => {
        const { offset, length } = asks[i] as { offset: number; length: number };
        expect(Buffer.compare(part, bytes.subarray(offset, offset + length)), `read ${i}`).toBe(0);
      });
    }
  }, 30_000);

  it("concurrent reads of one block share one request", async () => {
    const bytes = noise(1 << 20, 3);
    const { source, reads } = await plugin(bytes, () => 2);
    const before = reads.length;
    const got = await Promise.all(Array.from({ length: 10 }, () => source.read(4096, 1024)));
    for (const part of got) expect(Buffer.compare(part, bytes.subarray(4096, 5120))).toBe(0);
    expect(reads.length - before).toBe(1);
  });

  it("the cache stays at 64 blocks", async () => {
    const bytes = noise(8 << 20, 5);
    const { source, reads } = await plugin(bytes, () => 0);
    await source.read(0, 16);
    for (let block = 1; block <= 100; block++) await source.read(block * 65536, 16);
    const before = reads.length;
    await source.read(0, 16);
    expect(reads.length - before).toBe(1);
  });
});
