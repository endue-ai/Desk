import { afterEach, expect, it, vi } from "vitest";
import { Huffman } from "../../lib/rar/huffman.js";
import { entry, openFixture, original, sha256 } from "./helpers";

afterEach(() => vi.restoreAllMocks());

/** Charge the real decoder for each LZ symbol, independently of the host's speed. */
function slowSymbols(cost: number) {
  let elapsed = 0;
  let symbols = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const decode = Huffman.prototype.decode;
  vi.spyOn(Huffman.prototype, "decode").mockImplementation(function (this: Huffman, input) {
    if (this.size === 306) {
      elapsed += cost;
      symbols++;
    }
    return decode.call(this, input);
  });
  return { now: () => elapsed, symbols: () => symbols };
}

it.each([1 / 16, 1 / 8])(
  "yields within 25 ms when an LZ symbol costs %f ms, preserving the decoded bytes",
  async (cost) => {
    const clock = slowSymbols(cost);
    const segments: number[] = [];
    let previous = 0;
    const archive = await openFixture("rar5-dict.rar", {
      progress: () => {
        segments.push(clock.now() - previous);
        previous = clock.now();
      },
    });
    const bytes = await archive.read(entry(archive, "far.bin"));
    segments.push(clock.now() - previous);
    expect(segments.length).toBeGreaterThan(2);
    expect(Math.max(...segments)).toBeLessThan(25);
    expect(sha256(bytes)).toBe(sha256(original("far.bin")));
  },
);

it("observes cancellation during a slow compressed block before decoding the whole byte slice", async () => {
  const clock = slowSymbols(1 / 8);
  const controller = new AbortController();
  const archive = await openFixture("rar5-dict.rar", {
    signal: controller.signal,
    progress: () => controller.abort(),
  });
  await expect(archive.read(entry(archive, "far.bin"))).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(clock.symbols()).toBeGreaterThan(0);
  expect(clock.now()).toBeLessThan(25);
});
