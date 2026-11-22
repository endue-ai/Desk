// The stream between a copy's two sessions (PG-63): one chunk at a time, the end and a failure on
// either side reaching the other, and a cancel stopping both.
import { describe, expect, it } from "vitest";
import { createPipe } from "../ui/transfer/pipe.js";

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
});
