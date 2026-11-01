// @vitest-environment jsdom
// Opening large files: ranged reads with progress, the shared <desk-progress> after 300 ms, decoding
// of files over 8 MiB in a worker (ui/worker.js run in-process by a fake startWorker), and Cancel.

import { resolveObjectURL } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineElements } from "../../../packages/ui/src/elements/index";
import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { createView } from "../ui/view.js";
import { createHandler } from "../ui/worker.js";
import { concat, nifti, pngHeader, writer } from "./build";
import { disk, image, mount } from "./harness";

defineElements();

const CHUNK = 2 * 1024 * 1024;
const LARGE = 8 * 1024 * 1024;
const A = image("~/Pictures/a.png");
const BIG = image("~/Pictures/big.exr");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** An uncompressed scanline OpenEXR of HALF B, G, R channels: 1.0 red, 0.5 green, 0 blue. */
function exr(width: number, height: number) {
  const attr = (w: ReturnType<typeof writer>, name: string, type: string, body: Uint8Array) =>
    w.text(name).u8(0).text(type).u8(0).u32(body.length).raw(body);
  const channels = writer();
  for (const name of ["B", "G", "R"]) channels.text(name).u8(0).u32(1).u8(0, 0, 0, 0).u32(1).u32(1);
  channels.u8(0);
  const box = writer()
    .u32(0)
    .u32(0)
    .u32(width - 1)
    .u32(height - 1)
    .done();
  const head = writer().u32(20000630).u32(2);
  attr(head, "channels", "chlist", channels.done());
  attr(head, "compression", "compression", new Uint8Array([0]));
  attr(head, "dataWindow", "box2i", box);
  attr(head, "displayWindow", "box2i", box);
  head.u8(0);
  const row = 3 * width * 2;
  const start = head.length + height * 8;
  const out = new Uint8Array(start + height * (8 + row));
  out.set(head.done());
  const view = new DataView(out.buffer);
  for (let y = 0; y < height; y++) {
    const at = start + y * (8 + row);
    view.setUint32(head.length + y * 8, at, true);
    view.setUint32(at, y, true);
    view.setUint32(at + 4, row, true);
    for (const [c, half] of [0x0000, 0x3800, 0x3c00].entries())
      for (let x = 0; x < width; x++) view.setUint16(at + 8 + (c * width + x) * 2, half, true);
  }
  return out;
}

/** A worker started by the fake: messages both ways go through structuredClone with transfer. */
interface Fake {
  url: string;
  posted: Array<{ data: unknown; transfer: Transferable[] }>;
  replies: Array<{ data: unknown; transfer: Transferable[] }>;
  terminated: boolean;
}

/** startWorker for tests: runs ui/worker.js's handler in-process, or never answers when stuck. */
function fakeWorkers(stuck = false) {
  const workers: Fake[] = [];
  const start = vi.fn((url: string | URL) => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const fake: Fake = { url: String(url), posted: [], replies: [], terminated: false };
    workers.push(fake);
    const handle = createHandler((data: unknown, transfer: Transferable[] = []) => {
      if (fake.terminated) return;
      fake.replies.push({ data, transfer });
      const copy = structuredClone(data, { transfer });
      setTimeout(() => {
        if (fake.terminated) return;
        for (const listener of listeners) listener(new MessageEvent("message", { data: copy }));
      }, 0);
    });
    return {
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === "message") listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        listeners.delete(listener);
      },
      postMessage(data: unknown, transfer: Transferable[] = []) {
        fake.posted.push({ data, transfer });
        const copy = structuredClone(data, { transfer });
        if (!stuck) setTimeout(() => void handle(copy as Parameters<typeof handle>[0]), 0);
      },
      terminate() {
        fake.terminated = true;
      },
    } as unknown as Worker;
  });
  return { start, workers };
}

const progressOf = (view: { progress: ReturnType<typeof vi.fn> }) =>
  view.progress.mock.calls.map(([value]) => value).filter(Boolean) as Array<{
    label: string;
    value: number | null;
    max: number;
    detail: string;
    cancel(): void;
  }>;

describe("the progress bar", () => {
  it("shows Reading after 300 ms, then Decoding, cancels the job and hides", async () => {
    vi.useFakeTimers();
    const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    const view = createView(document, () => {});
    const progress = document.querySelector("desk-progress") as DeskProgress;
    expect(progress, "the surface has the shared progress element").not.toBeNull();
    expect(progress.hidden).toBe(true);
    const cancel = vi.fn();
    view.progress({ label: "Reading", value: 12, max: 24, detail: "12 of 24 bytes", cancel });
    await vi.advanceTimersByTimeAsync(299);
    expect(progress.shown).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(progress.shown).toBe(true);
    expect([progress.label, progress.value, progress.max, progress.detail]).toEqual([
      "Reading",
      12,
      24,
      "12 of 24 bytes",
    ]);
    view.progress({ label: "Decoding", value: null, max: 1, detail: "big.exr", cancel });
    expect([progress.shown, progress.indeterminate, progress.cancelable]).toEqual([
      true,
      true,
      true,
    ]);
    progress.shadowRoot?.querySelector("button")?.click();
    expect(cancel).toHaveBeenCalledOnce();
    view.progress(null);
    expect(progress.hidden).toBe(true);
  });
});

describe("reading in ranges", () => {
  it("reads through fs.url in 2 MiB parts, reports each, and shows the image from a blob URL", async () => {
    const bytes = concat(pngHeader(10, 20), new Uint8Array(CHUNK * 2 + 5 - pngHeader(1, 1).length));
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const range = /bytes=(\d+)-(\d+)/.exec((init.headers as Record<string, string>).Range ?? "");
      const start = Number(range?.[1]);
      return new Response(bytes.slice(start, Number(range?.[2]) + 1), { status: 206 });
    });
    vi.stubGlobal("fetch", fetcher);
    const { host, view } = await mount({
      handlers: {
        ...disk({ [A.path]: bytes }),
        "fs.url": () => ({ url: "https://file.invalid/a", type: "image/png", size: bytes.length }),
      },
    });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(host.calls.some((c) => c.method === "fs.read")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const reading = progressOf(view).filter((p) => p.label === "Reading" && (p.value ?? 0) > 0);
    expect(reading.map((p) => p.value)).toEqual([CHUNK, CHUNK * 2, bytes.length]);
    expect(reading.at(-1)?.detail).toBe(
      `${bytes.length.toLocaleString("en-US")} of ${bytes.length.toLocaleString("en-US")} bytes`,
    );
    expect(view.progress).toHaveBeenLastCalledWith(null);
    const src = view.states.at(-1)?.image?.src ?? "";
    expect(src).toMatch(/^blob:/);
    const blob = resolveObjectURL(src);
    expect(blob?.type).toBe("image/png");
    // Compared as buffers: toEqual walks 4 MiB element by element for seconds.
    const shown = Buffer.from((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(shown.length).toBe(bytes.length);
    expect(Buffer.compare(shown, Buffer.from(bytes))).toBe(0);
  }, 20_000);

  it("Cancel while reading stops the read, keeps the image on screen and says so", async () => {
    const fetcher = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("stopped", "AbortError")),
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const small = pngHeader(4, 3);
    const { host, view } = await mount({
      handlers: {
        ...disk({ [A.path]: small }),
        "fs.url": ({ path }) => ({
          url: `https://file.invalid/${path}`,
          type: "image/png",
          size: path === A.path ? small.length : LARGE + 1,
        }),
      },
    });
    vi.stubGlobal("fetch", async () => new Response(small, { status: 200 }));
    await host.command("desk.files.visit", A);
    view.progress.mockClear();
    vi.stubGlobal("fetch", fetcher);
    const visit = host.command("desk.files.visit", BIG);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    progressOf(view).at(-1)?.cancel();
    await expect(visit).rejects.toThrow("Opening big.exr was cancelled.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.calls.some((c) => c.method === "fs.read")).toBe(false);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: A.buffer, width: 4, height: 3 });
    expect(view.statuses.at(-1)).toBe("Opening big.exr was cancelled.");
  });
});

describe("decoding in a worker", () => {
  it("a large EXR decodes in the worker with progress, its pixels transferred", async () => {
    const bytes = exr(1024, 1400);
    expect(bytes.length).toBeGreaterThan(LARGE);
    const { start, workers } = fakeWorkers();
    const { host, view } = await mount({
      handlers: disk({ [BIG.path]: bytes }),
      startWorker: start,
    });
    await expect(host.command("desk.files.visit", BIG)).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledOnce();
    expect(new URL(workers[0]?.url ?? "").pathname).toMatch(/\/worker\.js$/);
    const [request] = workers[0]?.posted ?? [];
    expect(request?.transfer).toHaveLength(1);
    // Transferred: the main thread no longer holds the file's bytes.
    expect((request?.transfer[0] as ArrayBuffer | undefined)?.byteLength).toBe(0);
    const decoding = progressOf(view).filter((p) => p.label === "Decoding");
    expect(decoding.length).toBeGreaterThan(1);
    expect(decoding.at(-1)).toMatchObject({
      value: 1400,
      max: 1400,
      detail: "1,400 of 1,400 rows",
    });
    const done = workers[0]?.replies.find((r) => (r.data as { type?: string }).type === "done");
    expect(done?.transfer.length).toBeGreaterThan(0);
    expect(workers[0]?.terminated).toBe(true);
    const shown = view.states.at(-1)?.image;
    expect(shown).toMatchObject({ kind: "pixels", format: "OpenEXR", width: 1024, height: 1400 });
    expect(Array.from(shown?.pixels?.data.subarray(0, 4) ?? [])).toEqual([255, 188, 0, 255]);
    expect(view.progress).toHaveBeenLastCalledWith(null);
  }, 20_000);

  it("a small EXR decodes in place, without a worker", async () => {
    const { start } = fakeWorkers();
    const small = image("~/Pictures/small.exr");
    const { host, view } = await mount({
      handlers: disk({ [small.path]: exr(16, 8) }),
      startWorker: start,
    });
    await host.command("desk.files.visit", small);
    expect(start).not.toHaveBeenCalled();
    expect(view.states.at(-1)?.image).toMatchObject({ kind: "pixels", width: 16, height: 8 });
  });

  it("Cancel while decoding ends the worker and keeps the previous image", async () => {
    const { start, workers } = fakeWorkers(true);
    const { host, view } = await mount({
      handlers: disk({ [A.path]: pngHeader(4, 3), [BIG.path]: exr(1024, 1400) }),
      startWorker: start,
    });
    await host.command("desk.files.visit", A);
    view.progress.mockClear();
    const visit = host.command("desk.files.visit", BIG);
    await vi.waitFor(() => expect(progressOf(view).at(-1)?.label).toBe("Decoding"));
    progressOf(view).at(-1)?.cancel();
    await expect(visit).rejects.toThrow("Opening big.exr was cancelled.");
    expect(workers[0]?.terminated).toBe(true);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: A.buffer, width: 4, height: 3 });
    expect(view.statuses.at(-1)).toBe("Opening big.exr was cancelled.");
    expect(view.progress).toHaveBeenLastCalledWith(null);
  });

  it("a large volume keeps its worker for its slices until it closes", async () => {
    const volume = image("~/Scans/head.nii");
    const bytes = nifti(256, 256, 72, (x, y, z) => (x + y + z * 7) % 4096);
    expect(bytes.length).toBeGreaterThan(LARGE);
    const { start, workers } = fakeWorkers();
    const { host, view, app } = await mount({
      handlers: disk({ [volume.path]: bytes }),
      startWorker: start,
    });
    await host.command("desk.files.visit", volume);
    expect(view.states.at(-1)?.image?.slice).toEqual({ index: 36, count: 72 });
    expect(workers[0]?.terminated).toBe(false);
    const before = view.states.at(-1)?.image?.pixels?.data;
    await app.slice(1);
    const after = view.states.at(-1)?.image;
    expect(after?.slice).toEqual({ index: 37, count: 72 });
    expect(after?.pixels?.data).not.toEqual(before);
    await host.command("desk.buffers.closed", { buffer: volume.buffer });
    expect(workers[0]?.terminated).toBe(true);
  }, 20_000);
});
