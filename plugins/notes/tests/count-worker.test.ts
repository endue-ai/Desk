import { existsSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createCounter } from "../ui/counter.js";

/** A stand-in for the SDK's startWorker: runs count-worker.js's answer a turn later. */
async function fakeWorkers() {
  const { answer } = await import("../ui/count-worker.js");
  const started: Array<{ url: string; name?: string; terminated: boolean; texts: string[] }> = [];
  const start = (url: URL, options?: { name?: string }) => {
    const record = { url: url.href, name: options?.name, terminated: false, texts: [] as string[] };
    started.push(record);
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: { message: string }) => void) | null,
      postMessage(text: string) {
        record.texts.push(text);
        setTimeout(() => {
          if (record.terminated) return;
          if (text === "fail") worker.onerror?.({ message: "boom" });
          else worker.onmessage?.({ data: answer(text) });
        }, 5);
      },
      terminate() {
        record.terminated = true;
      },
    };
    return worker as unknown as Worker;
  };
  return { start, started };
}

describe("the notes counter", () => {
  it("counts in the worker module, across a real message boundary", async () => {
    expect(existsSync(join(import.meta.dirname, "../ui/count-worker.js"))).toBe(true);
    const { answer } = await import("../ui/count-worker.js");
    const { port1, port2 } = new MessageChannel();
    try {
      const reply = new Promise((resolve) => port1.once("message", resolve));
      port2.postMessage(answer("hello world, 안녕하세요"));
      expect(await reply).toEqual({ words: 3, characters: 18 });
    } finally {
      port1.close();
      port2.close();
    }
  });

  it("starts count-worker.js once and answers each count", async () => {
    const { start, started } = await fakeWorkers();
    const counter = createCounter(start);
    expect(await counter.count("one two")).toEqual({ words: 2, characters: 7 });
    expect(await counter.count("one two three")).toEqual({ words: 3, characters: 13 });
    expect(started).toHaveLength(1);
    expect(started[0]?.url).toMatch(/\/count-worker\.js$/);
    expect(started[0]?.name).toBe("Notes counter");
  });

  it("a newer text cancels the count running: that worker stops and a fresh one counts", async () => {
    const { start, started } = await fakeWorkers();
    const counter = createCounter(start);
    const old = counter.count("a long note");
    const latest = counter.count("short");
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    expect(await latest).toEqual({ words: 1, characters: 5 });
    expect(started.map((w) => w.terminated)).toEqual([true, false]);
    expect(started[1]?.texts).toEqual(["short"]);
  });

  it("cancel stops a running count; a stopped worker fails its count with a sentence", async () => {
    const { start, started } = await fakeWorkers();
    const counter = createCounter(start);
    const running = counter.count("words");
    counter.cancel();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(started[0]?.terminated).toBe(true);
    await expect(counter.count("fail")).rejects.toThrow("boom");
    expect(await counter.count("again")).toEqual({ words: 1, characters: 5 });
    expect(started).toHaveLength(3);
  });
});
