import { afterEach, expect, it, vi } from "vitest";
import { defineUiPlugin, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createData } from "../ui/data.js";
import { file, recordingView } from "./harness";
import { workerHarness } from "./worker-harness";

afterEach(() => vi.unstubAllGlobals());

it("visit reads binary ranges with chunk progress and transfers >1 MiB into the SDK worker", async () => {
  const payload = new TextEncoder().encode(`{"rows":[${'"fixture",'.repeat(300000)}null]}`);
  const target = file("~/data/large.json");
  const ranges: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const range = String(init.headers.Range);
      ranges.push(range);
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return new Response(payload.slice(Number(start), Number(end) + 1), { status: 206 });
    }),
  );
  const host = createTestHost({
    pluginId: "endue.data",
    handlers: {
      "fs.url": () => ({ url: "https://fixture.invalid/data", size: payload.length }),
      "fs.watch": () => ({ watchId: "fixture" }),
      "store.get": () => ({}),
    },
  });
  const view = { ...recordingView(), progress: vi.fn() };
  const worker = workerHarness();
  try {
    await defineUiPlugin(
      {
        mount(ctx) {
          createData(ctx, view, { readBytes, startWorker: worker.start });
        },
      },
      host.transport,
    );
    await host.command("desk.files.visit", target);
    expect(ranges.length).toBeGreaterThan(1);
    expect(host.calls.some((call) => call.method === "fs.read")).toBe(false);
    expect(worker.workers).toHaveLength(1);
    expect(view.shown.at(-1)?.opened.remote).toBeDefined();
    const states = view.progress.mock.calls.map(([state]) => state).filter(Boolean);
    expect(states.some((state) => state.phase === "Reading" && state.done === payload.length)).toBe(
      true,
    );
    expect(states.some((state) => state.phase === "Parsing" && state.done === payload.length)).toBe(
      true,
    );
    expect(view.progress).toHaveBeenLastCalledWith(null);
    await host.command("desk.buffers.closed", target);
    expect(worker.stopped()).toBe(1);
  } finally {
    worker.close();
    host.close();
  }
});

it("Cancel aborts a pending ranged read without replacing the current buffer", async () => {
  const host = createTestHost({
    pluginId: "endue.data",
    handlers: {
      "fs.url": () => ({ url: "https://fixture.invalid/slow", size: 2000000 }),
    },
  });
  const aborted = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            aborted();
            reject(new DOMException("Cancelled", "AbortError"));
          });
        }),
    ),
  );
  const view = { ...recordingView(), progress: vi.fn() };
  let app: ReturnType<typeof createData>;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createData(ctx, view, { readBytes, startWorker: vi.fn() });
      },
    },
    host.transport,
  );
  const visit = host.command("desk.files.visit", file("~/data/slow.json"));
  const result = expect(visit).rejects.toMatchObject({ message: expect.stringMatching(/cancel/i) });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  app!.cancel();
  await result;
  expect(aborted).toHaveBeenCalledOnce();
  expect(view.shown.at(-1)).toBeNull();
  expect(view.progress).toHaveBeenLastCalledWith(null);
  host.close();
});
