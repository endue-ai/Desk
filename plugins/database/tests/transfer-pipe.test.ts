// The stream between a copy's two sessions (PG-63): one chunk at a time, the end and a failure on
// either side reaching the other, a cancel stopping both, and a page past db.copy's limit cut on a
// character's edge.
import { describe, expect, it } from "vitest";
import { createPipe, piecesOf } from "../ui/transfer/pipe.js";

const chunk = (data: string) => ({ data, encoding: "utf8" as const, bytes: data.length });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the pipe of a copy", () => {
  it("streams source to target one chunk at a time", async () => {
    const pipe = createPipe();
    let wrote = 0;
    const writer = (async () => {
      for (const data of ["a", "b", "c"]) {
        await pipe.sink.write(chunk(data));
        wrote++;
      }
      await pipe.sink.close?.();
    })();
    await tick();
    // The second write waits until the reader took the first.
    expect(wrote).toBe(1);
    const read: string[] = [];
    for (;;) {
      const next = await pipe.source.read();
      if (!next) break;
      read.push(next.data);
    }
    await writer;
    expect(read).toEqual(["a", "b", "c"]);
  });

  it("a failure on either side reaches the other", async () => {
    const pipe = createPipe();
    const reading = pipe.source.read();
    pipe.fail(new Error("relation does not exist"));
    await expect(reading).rejects.toThrow("relation does not exist");
    const other = createPipe();
    await other.sink.write(chunk("a"));
    const writing = other.sink.write(chunk("b"));
    other.fail(new Error("the target stopped"));
    await expect(writing).rejects.toThrow("the target stopped");
  });

  it("a cancel stops both", async () => {
    const control = new AbortController();
    const pipe = createPipe(control.signal);
    const reading = pipe.source.read();
    control.abort();
    await expect(reading).rejects.toThrow("Cancelled.");
    await expect(pipe.sink.write(chunk("a"))).rejects.toThrow("Cancelled.");
  });

  it("cuts a chunk past the limit on a character's edge", () => {
    const text = "abécdé";
    const parts = piecesOf({ data: text, encoding: "utf8", bytes: 8 }, 3);
    expect(parts.map((p) => p.data)).toEqual(["ab", "éc", "dé"]);
    expect(parts.map((p) => p.bytes)).toEqual([2, 3, 3]);
    const raw = btoa("0123456789");
    const base = piecesOf({ data: raw, encoding: "base64", bytes: 10 }, 6);
    expect(base.map((p) => atob(p.data)).join("")).toBe("0123456789");
    expect(Math.max(...base.map((p) => p.bytes))).toBeLessThanOrEqual(6);
  });
});
