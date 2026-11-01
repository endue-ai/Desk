import type { FsReadPermission, FsReadResult } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { byteSource, connect } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

const SCOPE: FsReadPermission = { permission: "fs:read", paths: ["~/qa/**"] };
const FILE = { path: "~/qa/source.bin", scope: SCOPE };
const BYTES = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function plugin(options: Partial<TestHostOptions> = {}) {
  const host = createTestHost({
    pluginId: "test.byte-source",
    grants: [SCOPE],
    files: { [FILE.path]: BYTES },
    handlers: {
      "fs.url": () => ({
        url: "/_desk/file/source.bin",
        size: BYTES.length,
        type: "application/octet-stream",
      }),
    },
    ...options,
  });
  return { ctx: await connect(host.transport), host };
}

afterEach(() => vi.unstubAllGlobals());

describe("byteSource cancellation", () => {
  it.each([false, true])(
    "rejects cached, new and empty reads after abort (whole=%s)",
    async (whole) => {
      const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const range = new Headers(init?.headers).get("range") ?? "";
        const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range) ?? [];
        return new Response(whole ? BYTES.slice() : BYTES.slice(Number(from), Number(to) + 1), {
          status: whole ? 200 : 206,
        });
      });
      vi.stubGlobal("fetch", fetch);
      const { ctx, host } = await plugin();
      const stop = new AbortController();
      const source = await byteSource(ctx, FILE, { signal: stop.signal });
      expect(await source.read(10, 5)).toEqual(BYTES.slice(10, 15));
      expect(await source.read(10, 5)).toEqual(BYTES.slice(10, 15));
      const calls = host.calls.length;
      const requests = fetch.mock.calls.length;

      stop.abort(new Error("A caller-specific reason"));

      for (const [offset, length] of [
        [10, 5],
        [90_000, 5],
        [0, 0],
        [BYTES.length, 5],
      ] as const) {
        await expect(source.read(offset, length)).rejects.toMatchObject({ name: "AbortError" });
      }
      expect(host.calls).toHaveLength(calls);
      expect(fetch).toHaveBeenCalledTimes(requests);
    },
  );

  it("passes the lifetime signal to an in-flight fetch and aborts without fallback", async () => {
    const started = deferred<void>();
    const release = deferred<Response>();
    let received: AbortSignal | null | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      received = init?.signal;
      started.resolve();
      return new Promise<Response>((resolve, reject) => {
        received?.addEventListener("abort", () => reject(received?.reason), { once: true });
        void release.promise.then(resolve);
      });
    });
    vi.stubGlobal("fetch", fetch);
    const { ctx, host } = await plugin();
    const stop = new AbortController();
    const source = await byteSource(ctx, FILE, { signal: stop.signal });
    const outcome = source.read(0, 10).catch((error: unknown) => error);
    await started.promise;
    stop.abort("Stop now");
    try {
      expect(received).toBe(stop.signal);
      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(host.calls.map((call) => call.method)).toEqual(["fs.url"]);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve(new Response(BYTES.slice(), { status: 206 }));
      await outcome;
    }
  });

  it("discards a late partial response and requests no remaining ranges", async () => {
    const stop = new AbortController();
    const fetch = vi.fn(async () => {
      stop.abort();
      return new Response(BYTES.slice(0, 16), { status: 206 });
    });
    vi.stubGlobal("fetch", fetch);
    const { ctx, host } = await plugin();
    const source = await byteSource(ctx, FILE, { signal: stop.signal });

    await expect(source.read(0, 100)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.calls.map((call) => call.method)).toEqual(["fs.url"]);
  });

  it("cancels a pending whole-response stream without waiting for another chunk", async () => {
    const pending = deferred<void>();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start: (value) => {
        controller = value;
      },
      cancel,
    });
    const getReader = body.getReader.bind(body);
    vi.spyOn(body, "getReader").mockImplementation(() => {
      const reader = getReader();
      const read = reader.read.bind(reader);
      vi.spyOn(reader, "read").mockImplementation(() => {
        pending.resolve();
        return read();
      });
      return reader;
    });
    const fetch = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { ctx } = await plugin();
    const stop = new AbortController();
    const source = await byteSource(ctx, FILE, { signal: stop.signal });
    const outcome = source.read(0, 10).catch((error: unknown) => error);
    await pending.promise;

    stop.abort();

    try {
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (cancel.mock.calls.length === 0) controller.close();
      await outcome;
    }
  });

  it("rejects a late bridge range without requesting the next part", async () => {
    const started = deferred<void>();
    const release = deferred<FsReadResult>();
    let reads = 0;
    const { ctx, host } = await plugin({
      refuse: { "fs.url": "unsupported" },
      handlers: {
        "fs.read": (params) => {
          expect(params).toMatchObject({ path: FILE.path, scope: SCOPE, encoding: "base64" });
          if (params.length === 0) return { content: "", encoding: "base64", size: BYTES.length };
          reads++;
          if (reads > 1) return { content: "", encoding: "base64" };
          started.resolve();
          return release.promise;
        },
      },
    });
    const stop = new AbortController();
    const source = await byteSource(ctx, FILE, { signal: stop.signal });
    const outcome = source.read(0, 100).catch((error: unknown) => error);
    await started.promise;
    stop.abort();
    release.resolve({ content: btoa("a short part"), encoding: "base64" });

    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(reads).toBe(1);
    expect(host.calls.map((call) => call.method)).toEqual(["fs.url", "fs.read", "fs.read"]);
    await expect(source.read(0, 0)).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBe(1);
  });

  it("rejects creation when cancelled while fallback metadata is pending", async () => {
    const started = deferred<void>();
    const release = deferred<FsReadResult>();
    const { ctx, host } = await plugin({
      refuse: { "fs.url": "unsupported" },
      handlers: {
        "fs.read": () => {
          started.resolve();
          return release.promise;
        },
      },
    });
    const stop = new AbortController();
    const outcome = byteSource(ctx, FILE, { signal: stop.signal }).catch((error: unknown) => error);
    await started.promise;
    stop.abort();
    release.resolve({ content: "", encoding: "base64", size: BYTES.length });

    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(host.calls.map((call) => call.method)).toEqual(["fs.url", "fs.read"]);
  });
});
