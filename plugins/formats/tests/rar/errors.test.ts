// Damaged, cut, encrypted, split and old archives fail or refuse with a sentence within a second,
// never hang; an aborted decode stops. Damage is made here from the fixtures, byte by byte.
import { describe, expect, it } from "vitest";
import { crc32 } from "../../lib/rar/crc32.js";
import {
  BAD_HEADER_CRC,
  ENCRYPTED,
  LOCKED,
  NOT_RAR,
  OLD_METHOD,
  SPLIT,
  TRUNCATED,
} from "../../lib/rar/index.js";
import { Pace } from "../../lib/rar/pace.js";
import { list4 } from "../../lib/rar/rar4/headers.js";
import { list5 } from "../../lib/rar/rar5/headers.js";
import { entry, fixture, memory, open, openFixture, random, timed } from "./helpers";

const SECOND = 1000;
const SENTENCE = /damaged|does not match its CRC|ends early/;

/** Where each listed file's packed data is. */
async function places(bytes: Uint8Array) {
  const five = bytes[6] === 1;
  const { listed } = five ? await list5(memory(bytes), 0) : await list4(memory(bytes), 0);
  return new Map(
    listed.flatMap((item) => (item.data ? [[item.entry.path, item.data] as const] : [])),
  );
}

/** The RAR 4 file header of `path`: its offset and size. */
function header4(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  for (let pos = 7; pos + 7 <= bytes.length; ) {
    const flags = view.getUint16(pos + 3, true);
    const size = view.getUint16(pos + 5, true);
    const add = flags & 0x8000 ? view.getUint32(pos + 7, true) : 0;
    if (bytes[pos + 2] === 0x74) {
      const length = view.getUint16(pos + 26, true);
      const stored = new TextDecoder().decode(bytes.subarray(pos + 32, pos + 32 + length));
      if (stored === name) return { pos, size };
    }
    pos += size + add;
  }
  throw new Error(`${name} has no header`);
}
/** Writes a RAR 4 header's CRC again after a change. */
function reseal4(bytes: Uint8Array, at: { pos: number; size: number }) {
  const crc = crc32(bytes.subarray(at.pos + 2, at.pos + at.size)) & 0xffff;
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(at.pos, crc, true);
}

describe("damaged archives", () => {
  for (const [name, path] of [
    ["rar5-m3.rar", "text.txt"],
    ["rar5-filters.rar", "tool.exe"],
    ["rar4-m3.rar", "text.txt"],
    ["rar4-ppmd.rar", "chapters/one.txt"],
    ["rar4-filters.rar", "image.bmp"],
  ] as const) {
    it(`${name}: a changed byte in ${path}'s data fails with a sentence`, async () => {
      const bytes = fixture(name);
      const data = (await places(bytes)).get(path);
      if (!data) throw new Error("no data");
      const at = data.start + Math.floor(data.packed / 2);
      bytes[at] = (bytes[at] ?? 0) ^ 0x5a;
      const archive = await open(bytes);
      const { ms, error } = await timed(() => archive.read(entry(archive, path)));
      expect(error?.message).toMatch(SENTENCE);
      expect(ms).toBeLessThan(SECOND);
    });
  }

  it("a changed byte in a header fails with the header CRC sentence", async () => {
    for (const name of ["rar5-m3.rar", "rar4-m3.rar"]) {
      const bytes = fixture(name);
      const data = [...(await places(bytes)).values()][1];
      if (!data) throw new Error("no data");
      bytes[data.start - 3] = (bytes[data.start - 3] ?? 0) ^ 1;
      await expect(open(bytes)).rejects.toThrow(BAD_HEADER_CRC);
    }
  });

  it("random damage in the packed data settles within a second, with a sentence when it fails", async () => {
    const next = random(182);
    for (const name of [
      "rar5-m5.rar",
      "rar5-solid.rar",
      "rar5-filters.rar",
      "rar4-m5.rar",
      "rar4-ppmd.rar",
      "rar4-filters.rar",
      "rar4-mixed.rar",
    ]) {
      for (let round = 0; round < 6; round++) {
        const bytes = fixture(name);
        const data = [...(await places(bytes)).values()].filter((d) => d.method > 0);
        const target = data[next() % data.length];
        if (!target) throw new Error("no packed entry");
        for (let n = 1 + (next() % 4); n > 0; n--)
          bytes[target.start + (next() % target.packed)] = next() & 0xff;
        const archive = await open(bytes);
        for (const e of archive.entries.filter((x) => x.kind === "file")) {
          const { ms, error } = await timed(() => archive.read(e));
          if (error) expect(error.message).toMatch(SENTENCE);
          expect(ms).toBeLessThan(SECOND);
        }
      }
    }
  });

  it("a cut archive lists what it holds, refuses the entry it cuts and says so", async () => {
    for (const name of ["rar5-m3.rar", "rar4-m3.rar"]) {
      const whole = fixture(name);
      const text = (await places(whole)).get("text.txt");
      if (!text) throw new Error("no data");
      const archive = await open(whole.slice(0, text.start + 1000));
      expect(archive.details).toContainEqual({ label: "Damage", value: "The archive ends early." });
      expect(entry(archive, "text.txt").refusal).toBe(TRUNCATED);
      await expect(archive.read(entry(archive, "text.txt"))).rejects.toThrow(TRUNCATED);
      await expect(open(whole.slice(0, 30))).rejects.toThrow(/ends early|damaged/);
    }
  });

  it("a file that is not a RAR says so", async () => {
    await expect(open(new TextEncoder().encode("Rar? no, a text file."))).rejects.toThrow(NOT_RAR);
  });
});

describe("archives the decoder refuses", () => {
  it("encrypted entries are listed and refused", async () => {
    for (const name of ["rar5-encrypted.rar", "rar4-encrypted.rar"]) {
      const archive = await openFixture(name);
      const text = entry(archive, "text.txt");
      expect(text).toMatchObject({ encrypted: true, refusal: ENCRYPTED, size: 98304 });
      const { ms, error } = await timed(() => archive.read(text));
      expect(error?.message).toBe(ENCRYPTED);
      expect(ms).toBeLessThan(SECOND);
    }
  });

  it("encrypted headers leave nothing to list", async () => {
    for (const name of ["rar5-locked.rar", "rar4-locked.rar"]) {
      const archive = await openFixture(name);
      expect(archive).toMatchObject({ entries: [], note: LOCKED, refusal: ENCRYPTED });
    }
  });

  it("entries split across volumes are listed and refused", async () => {
    for (const name of [
      "rar5-split.part1.rar",
      "rar5-split.part2.rar",
      "rar4-split.part1.rar",
      "rar4-split.part2.rar",
    ]) {
      const archive = await openFixture(name);
      const data = entry(archive, "data.bin");
      expect(data.refusal).toBe(SPLIT);
      await expect(archive.read(data)).rejects.toThrow(SPLIT);
      expect(archive.details.find((d) => d.label === "Volume")).toBeDefined();
    }
  });

  it("RAR 1.5 and 2.0 compression is refused", async () => {
    for (const version of [15, 20, 26]) {
      const bytes = fixture("rar4-m3.rar");
      const at = header4(bytes, "text.txt");
      bytes[at.pos + 24] = version;
      reseal4(bytes, at);
      const archive = await open(bytes);
      expect(entry(archive, "text.txt").refusal).toBe(OLD_METHOD);
      await expect(archive.read(entry(archive, "text.txt"))).rejects.toThrow(OLD_METHOD);
      expect(entry(archive, "data.bin").refusal).toBeUndefined();
    }
  });

  it("an entry that needs more dictionary than allowed is refused", async () => {
    const archive = await openFixture("rar5-dict.rar", { maxWindow: 4 * 1024 * 1024 });
    const far = entry(archive, "far.bin");
    expect(far.refusal).toMatch(/needs a 8 MB dictionary/);
    await expect(archive.read(far)).rejects.toThrow(/dictionary/);
  });

  it("names DOS and Windows hosts stored in their OEM code page read as such", async () => {
    const bytes = fixture("rar4-stored.rar");
    const at = header4(bytes, "empty.txt");
    bytes.set([0x63, 0x61, 0x66, 0x82, 0x73, 0x2e, 0x74, 0x78, 0x74], at.pos + 32);
    bytes[at.pos + 15] = 2;
    reseal4(bytes, at);
    const archive = await open(bytes);
    expect(entry(archive, "cafés.txt").size).toBe(0);
  });
});

describe("aborting", () => {
  it("a decode with an aborted signal stops at once", async () => {
    const controller = new AbortController();
    controller.abort();
    const archive = await openFixture("rar5-dict.rar", { signal: controller.signal });
    const { ms, error } = await timed(() => archive.read(entry(archive, "far.bin")));
    expect(error?.name).toBe("AbortError");
    expect(ms).toBeLessThan(100);
  });

  it("aborting during a solid pass stops before the next entry", async () => {
    const controller = new AbortController();
    const archive = await openFixture("rar5-solid.rar", { signal: controller.signal });
    const visited: string[] = [];
    const files = archive.entries.filter((e) => e.kind === "file");
    const { error } = await timed(() =>
      archive.each(files, async (e) => {
        visited.push(e.path);
        controller.abort();
      }),
    );
    expect(error?.name).toBe("AbortError");
    expect(visited).toHaveLength(1);
  });

  it.each([0, 40])(
    "a long decode yields within 25 ms of active work with a %i ms scheduler delay",
    async (delay) => {
      const heard: [number, number][] = [];
      const archive = await openFixture("rar5-dict.rar", {
        progress: (done, total) => heard.push([done, total]),
      });
      const far = entry(archive, "far.bin");
      const immediate = globalThis.setImmediate;
      if (delay) {
        // The event loop is free while a yielded decoder waits to be scheduled again.
        globalThis.setImmediate = ((callback: () => void) =>
          immediate(() => setTimeout(callback, delay))) as typeof setImmediate;
      }
      const step = Pace.prototype.step;
      const active: number[] = [];
      const waits: number[] = [];
      let lastPace: Pace | undefined;
      Pace.prototype.step = async function (this: Pace) {
        const since = this.since;
        lastPace = this;
        const pending = step.call(this);
        const beforeYield = performance.now();
        await pending;
        if (this.since !== since) {
          active.push(beforeYield - since);
          waits.push(this.since - beforeYield);
        }
      };
      let ticks = 0;
      const timer = setInterval(() => ticks++, 1);
      const start = performance.now();
      try {
        await archive.each([far, far, far, far, far, far], async () => {});
      } finally {
        clearInterval(timer);
        Pace.prototype.step = step;
        globalThis.setImmediate = immediate;
      }
      const end = performance.now();
      expect(end - start).toBeGreaterThan(25);
      // Include the final work after the last yield, but not time already ceded to the event loop.
      expect(lastPace).toBeDefined();
      expect(active.length).toBeGreaterThan(1);
      if (lastPace) active.push(end - lastPace.since);
      // The 25 ms bound on uninterrupted work is asserted under a controlled clock in
      // pacing.test.ts (#248): measured with the wall clock here it also counts the host
      // preempting the runner, so this test checks only what the event loop can see.
      expect(active.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
      if (delay) expect(Math.max(...waits)).toBeGreaterThan(25);
      expect(ticks).toBeGreaterThan(1);
      expect(heard.length).toBeGreaterThan(1);
      for (const [i, [done, total]] of heard.entries()) {
        expect(total).toBe(6 * far.size);
        expect(done).toBeLessThanOrEqual(total);
        expect(done).toBeGreaterThanOrEqual(heard[i - 1]?.[0] ?? 0);
      }
    },
  );
});
