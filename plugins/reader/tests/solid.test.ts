// The one pass through a solid archive: decoded once in the archive's order, each page handed over
// as it comes out, paused while nobody waits, failing every later page with the library's sentence.
import { describe, expect, it } from "vitest";
import { createPass } from "../ui/formats/solid.js";

const ENTRIES = ["a", "b", "c", "d"];
const bytesOf = (name: string) => new TextEncoder().encode(name);
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A library each() over ENTRIES that records what it decoded and can fail at an entry. */
function library(failAt?: string) {
  const seen: string[] = [];
  let passes = 0;
  const each = async (
    wanted: string[],
    visit: (entry: string, bytes: Uint8Array) => Promise<unknown>,
  ) => {
    passes++;
    for (const entry of wanted) {
      await turn();
      if (entry === failAt) throw new Error("The RAR data is damaged and cannot be decoded.");
      seen.push(entry);
      await visit(entry, bytesOf(entry));
    }
  };
  return { each, seen, passes: () => passes };
}

describe("the solid pass", () => {
  it("hands each entry over as it decodes and pauses once nobody waits", async () => {
    const lib = library();
    const pass = createPass(lib.each, ENTRIES, () => 10);
    expect(new TextDecoder().decode(await pass.want("b"))).toBe("b");
    for (let i = 0; i < 5; i++) await turn();
    expect(lib.seen).toEqual(["a", "b"]);
    expect(new TextDecoder().decode(await pass.want("a"))).toBe("a");
    const reports: Array<[number, number]> = [];
    await pass.want("d", undefined, (done: number, total: number) => reports.push([done, total]));
    expect(lib.seen).toEqual(["a", "b", "c", "d"]);
    expect(lib.passes()).toBe(1);
    expect(reports[0]).toEqual([20, 40]);
    expect(reports.at(-1)).toEqual([30, 40]);
  });

  it("a withdrawn wait pauses the pass where it is; the next wait goes on from there", async () => {
    const lib = library();
    const pass = createPass(lib.each, ENTRIES, () => 1);
    const stop = new AbortController();
    const waiting = pass.want("d", stop.signal).catch((error) => error);
    await turn();
    stop.abort();
    expect(await waiting).toMatchObject({ name: "AbortError" });
    for (let i = 0; i < 6; i++) await turn();
    expect(lib.seen.length).toBeLessThan(4);
    await pass.want("d");
    expect(lib.seen).toEqual(ENTRIES);
    expect(lib.passes()).toBe(1);
  });

  it("a failure reaches the waiting page and every later one; earlier pages stay", async () => {
    const lib = library("c");
    const pass = createPass(lib.each, ENTRIES, () => 1);
    await expect(pass.want("d")).rejects.toThrow("The RAR data is damaged and cannot be decoded.");
    await expect(pass.want("c")).rejects.toThrow("damaged");
    expect(new TextDecoder().decode(await pass.want("a"))).toBe("a");
    expect(lib.passes()).toBe(1);
  });

  it("closing stops the pass and fails the pages still waited for", async () => {
    const lib = library();
    const pass = createPass(lib.each, ENTRIES, () => 1);
    const waiting = pass.want("d").catch((error) => error);
    pass.close();
    expect(await waiting).toMatchObject({ name: "AbortError" });
    await expect(pass.want("a")).rejects.toMatchObject({ name: "AbortError" });
    await expect(pass.want("zz")).rejects.toMatchObject({ name: "AbortError" });
  });
});
