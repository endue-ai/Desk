import type { FsReadPermission } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHUNK } from "./files";
import { byteSource, connect, readBytes } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

const MiB = 1024 * 1024;
const SCOPE: FsReadPermission = { permission: "fs:read", paths: ["~/qa/**"] };
const PATH = "~/qa/big.bin";
const FILE = { path: PATH, scope: SCOPE };
const URL_OF_FILE = "/_desk/file/0123456789abcdef0123456789abcdef/big.bin";

/** `length` bytes that differ from their neighbours, so a misplaced range shows. */
const bytesOf = (length: number) =>
  Uint8Array.from({ length }, (_, i) => (i * 7 + (i >> 16)) & 0xff);

/**
 * The app's file URL as protocol.rs serves it: one range per request, at most `part` bytes, 206
 * with Content-Range, 416 past the end; or, with `ignoreRange`, 200 with the whole file.
 */
function fakeScheme(bytes: Uint8Array, options: { part?: number; ignoreRange?: boolean } = {}) {
  const part = options.part ?? 2 * MiB;
  const ranges: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(URL_OF_FILE);
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const range = new Headers(init?.headers).get("range");
    ranges.push(range ?? "none");
    if (options.ignoreRange || !range) return new Response(bytes.slice(), { status: 200 });
    const [, first = "", last = ""] = /^bytes=(\d+)-(\d*)$/.exec(range) ?? [];
    const start = Number(first);
    if (start >= bytes.length) {
      const headers = { "Content-Range": `bytes */${bytes.length}` };
      return new Response(null, { status: 416, headers });
    }
    const end = Math.min(bytes.length - 1, last ? Number(last) : Infinity, start + part - 1);
    const headers = { "Content-Range": `bytes ${start}-${end}/${bytes.length}` };
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, ranges };
}

async function plugin(bytes: Uint8Array, options: Partial<TestHostOptions> = {}) {
  const host = createTestHost({
    pluginId: "test.files",
    grants: [SCOPE],
    files: { [PATH]: bytes },
    handlers: {
      "fs.url": () => ({ url: URL_OF_FILE, size: bytes.length, type: "application/octet-stream" }),
    },
    ...options,
  });
  const ctx = await connect(host.transport);
  return { host, ctx, methods: () => host.calls.map((call) => call.method) };
}

afterEach(() => vi.unstubAllGlobals());

describe("readBytes", () => {
  it("reads in ranged chunks through fs.url and fetch, with progress after each", async () => {
    const bytes = bytesOf(5 * MiB + 1);
    const { fetch, ranges } = fakeScheme(bytes);
    const { ctx, methods } = await plugin(bytes);
    const progress: Array<[number, number]> = [];

    const read = await readBytes(ctx, FILE, {
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(read).toBeInstanceOf(Uint8Array);
    expect(read.length).toBe(bytes.length);
    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
    expect(methods()).toEqual(["fs.url"]);
    expect(CHUNK).toBe(2 * MiB);
    expect([...ranges].sort()).toEqual(
      [
        `bytes=0-${CHUNK - 1}`,
        `bytes=${CHUNK}-${2 * CHUNK - 1}`,
        `bytes=${2 * CHUNK}-${5 * MiB}`,
      ].sort(),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(progress).toHaveLength(3);
    expect(progress.every(([, total]) => total === bytes.length)).toBe(true);
    expect(progress.map(([done]) => done)).toEqual(
      [...progress.map(([done]) => done)].sort((a, b) => a - b),
    );
    expect(progress.at(-1)).toEqual([bytes.length, bytes.length]);
  });

  it("asks again from where a short answer ended", async () => {
    const bytes = bytesOf(3 * MiB);
    const { ranges } = fakeScheme(bytes, { part: 1 * MiB });
    const { ctx } = await plugin(bytes);
    const progress: number[] = [];

    const read = await readBytes(ctx, FILE, { onProgress: (done) => progress.push(done) });

    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
    expect(ranges).toContain(`bytes=${1 * MiB}-${CHUNK - 1}`);
    expect(progress).toHaveLength(3);
  });

  it("takes the whole body when the server ignores Range", async () => {
    const bytes = bytesOf(3 * MiB + 5);
    const { fetch } = fakeScheme(bytes, { ignoreRange: true });
    const { ctx } = await plugin(bytes);
    const progress: number[] = [];

    const read = await readBytes(ctx, FILE, { onProgress: (done) => progress.push(done) });

    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toBe(bytes.length);
  });

  it("reads the data: URL the test host's fs.url answers, with no fetch stubbed", async () => {
    const bytes = bytesOf(300_000);
    const { ctx } = await plugin(bytes, { handlers: {} });
    const read = await readBytes(ctx, FILE);
    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
  });

  it("falls back to fs.read ranges as base64 when fs.url is refused", async () => {
    const bytes = bytesOf(9 * MiB + 3);
    const { fetch } = fakeScheme(bytes);
    const { host, ctx, methods } = await plugin(bytes, {
      handlers: {},
      refuse: { "fs.url": "unsupported" },
    });
    const progress: number[] = [];

    const read = await readBytes(ctx, FILE, { onProgress: (done) => progress.push(done) });

    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(methods()[0]).toBe("fs.url");
    const reads = host.calls.filter((call) => call.method === "fs.read");
    expect(reads.length).toBeGreaterThan(1);
    for (const call of reads) {
      expect(call.params).toMatchObject({ path: PATH, encoding: "base64", scope: SCOPE });
      expect(call.params).toHaveProperty("offset");
      expect(call.params).toHaveProperty("length");
    }
    expect(progress.at(-1)).toBe(bytes.length);
  });

  it("falls back to fs.read when fetch cannot reach the URL", async () => {
    const bytes = bytesOf(100_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Load failed"))),
    );
    const { methods, ctx } = await plugin(bytes);
    const read = await readBytes(ctx, FILE);
    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
    expect(methods()).toContain("fs.read");
  });

  it("is refused without a grant, as fs.read is", async () => {
    const bytes = bytesOf(10);
    const { ctx } = await plugin(bytes, { grants: [], handlers: {} });
    await expect(readBytes(ctx, FILE)).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("stops with an AbortError on its signal and asks for nothing more", async () => {
    const bytes = bytesOf(12 * MiB);
    const { fetch } = fakeScheme(bytes);
    const { ctx } = await plugin(bytes);
    const stop = new AbortController();

    const reading = readBytes(ctx, FILE, { signal: stop.signal, onProgress: () => stop.abort() });

    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch.mock.calls.length).toBeLessThan(6);

    const before = new AbortController();
    before.abort();
    await expect(readBytes(ctx, FILE, { signal: before.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("stops on its signal in the fs.read fallback too", async () => {
    const bytes = bytesOf(9 * MiB);
    const { host, ctx } = await plugin(bytes, {
      handlers: {},
      refuse: { "fs.url": "unsupported" },
    });
    const stop = new AbortController();
    const reading = readBytes(ctx, FILE, { signal: stop.signal, onProgress: () => stop.abort() });
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(host.calls.filter((call) => call.method === "fs.read").length).toBeLessThan(4);
  });
});

describe("byteSource", () => {
  it("answers exact ranges, clamped to the file", async () => {
    const bytes = bytesOf(1 * MiB + 17);
    fakeScheme(bytes);
    const { ctx } = await plugin(bytes);
    const source = await byteSource(ctx, FILE);

    expect(source.size).toBe(bytes.length);
    const same = (offset: number, length: number) =>
      source.read(offset, length).then((got) => {
        const want = bytes.subarray(offset, Math.min(bytes.length, offset + length));
        expect(Buffer.from(got).equals(Buffer.from(want)), `${offset}+${length}`).toBe(true);
      });
    await same(0, 4);
    await same(10, 20);
    await same(65_530, 20); // across a block boundary
    await same(bytes.length - 5, 100); // past the end
    await same(300_000, 700_000); // a long read
    expect((await source.read(bytes.length + 10, 4)).length).toBe(0);
    expect((await source.read(5, 0)).length).toBe(0);
  });

  it("serves repeated and neighbouring reads from its cache", async () => {
    const bytes = bytesOf(4 * MiB);
    const { fetch } = fakeScheme(bytes);
    const { ctx } = await plugin(bytes);
    const source = await byteSource(ctx, FILE);

    await source.read(1000, 100);
    const once = fetch.mock.calls.length;
    expect(once).toBe(1);
    await source.read(1000, 100);
    await source.read(1200, 300);
    expect(fetch.mock.calls.length).toBe(once);
    // The end of the file is a new block: one more request.
    await source.read(bytes.length - 22, 22);
    expect(fetch.mock.calls.length).toBe(once + 1);
  });

  it("reads through fs.read when fs.url is refused", async () => {
    const bytes = bytesOf(200_000);
    const { host, ctx } = await plugin(bytes, {
      handlers: {},
      refuse: { "fs.url": "unsupported" },
    });
    const source = await byteSource(ctx, FILE);
    expect(source.size).toBe(bytes.length);
    const got = await source.read(150_000, 10);
    expect(Buffer.from(got).equals(Buffer.from(bytes.subarray(150_000, 150_010)))).toBe(true);
    const reads = host.calls.filter((call) => call.method === "fs.read").length;
    await source.read(150_002, 4);
    expect(host.calls.filter((call) => call.method === "fs.read").length).toBe(reads);
  });

  it("keeps a body the server sent whole, and asks no more", async () => {
    const bytes = bytesOf(70_000);
    const { fetch } = fakeScheme(bytes, { ignoreRange: true });
    const { ctx } = await plugin(bytes);
    const source = await byteSource(ctx, FILE);
    expect(
      Buffer.from(await source.read(69_990, 10)).equals(Buffer.from(bytes.subarray(69_990))),
    ).toBe(true);
    expect(Buffer.from(await source.read(5, 5)).equals(Buffer.from(bytes.subarray(5, 10)))).toBe(
      true,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
