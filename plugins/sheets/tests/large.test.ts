import { afterEach, describe, expect, it, vi } from "vitest";
import { readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createSheets, type Open } from "../ui/sheets.js";
import { file, recordingView } from "./harness";

const A = file("~/Documents/large.csv");
const CHUNK = 2 * 1024 * 1024;
afterEach(() => vi.unstubAllGlobals());

function setup(size: number, url = true) {
  const host = createTestHost({
    pluginId: "endue.sheets",
    handlers: {
      "init.get": () => ({ profile: "default", settings: {} }),
      "fs.url": () => {
        if (!url) throw new Error("unavailable");
        return { url: "https://file.invalid/token", type: "text/csv", size };
      },
      "fs.read": ({ offset = 0, length = size }) => ({
        content: Buffer.alloc(Math.min(length, size - offset), 65).toString("base64"),
        encoding: "base64",
        size,
      }),
      "fs.watch": () => ({ watchId: "w" }),
    },
  });
  const view = Object.assign(recordingView(), { progress: vi.fn() });
  const open = vi.fn<Open>((_bytes: Uint8Array) => ({
    kind: "details" as const,
    format: "CSV",
    detected: "Text",
    reason: "Parsed",
  }));
  return { host, view, open };
}

async function mounted(size: number, url = true) {
  const { defineUiPlugin } = await import("../../../packages/plugin-sdk/src/index");
  const h = setup(size, url);
  await defineUiPlugin(
    {
      mount(ctx) {
        createSheets(ctx, h.view, { open: h.open, read: readBytes });
      },
    },
    h.host.transport,
  );
  return h;
}

describe("large spreadsheet reads", () => {
  it("reads fs.url in ranges, reports every chunk and supplies bytes to the parser", async () => {
    const size = CHUNK * 2 + 9;
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const range = /bytes=(\d+)-(\d+)/u.exec((init.headers as Record<string, string>).Range ?? "");
      const start = Number(range?.[1]);
      const end = Number(range?.[2]);
      return new Response(new Uint8Array(end - start + 1).fill(65), { status: 206 });
    });
    vi.stubGlobal("fetch", fetcher);
    const h = await mounted(size);
    await h.host.command("desk.files.visit", A);
    expect(h.host.calls.some((c) => c.method === "fs.url")).toBe(true);
    expect(h.host.calls.some((c) => c.method === "fs.read")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(h.open.mock.calls[0]?.[0]).toHaveLength(size);
    expect(
      h.view.progress.mock.calls
        .map(([p]) => p)
        .filter((p) => p?.label === "Reading" && p.value > 0),
    ).toHaveLength(3);
  });

  it("a refused URL falls back to bounded bridge ranges", async () => {
    const h = await mounted(CHUNK + 3, false);
    await h.host.command("desk.files.visit", A);
    const reads = h.host.calls.filter((c) => c.method === "fs.read").map((c) => c.params);
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offset: 0, length: 0 }),
        expect.objectContaining({ offset: 0, length: CHUNK }),
        expect.objectContaining({ offset: CHUNK, length: 3 }),
      ]),
    );
  });

  it("Cancel aborts the fetch and restores the preceding surface", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal = init.signal ?? undefined;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Stopped", "AbortError")),
            );
          }),
      ),
    );
    const h = await mounted(CHUNK);
    const pending = h.host.command("desk.files.visit", A).catch((error) => error);
    await vi.waitFor(() => expect(signal).toBeDefined());
    const progress = h.view.progress.mock.calls.at(-1)?.[0];
    expect(progress?.cancel).toBeTypeOf("function");
    progress.cancel();
    expect(await pending).toMatchObject({ message: "failed: Opening large.csv was cancelled." });
    expect(signal?.aborted).toBe(true);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.view.shown.at(-1)).toBeNull();
    expect(h.view.statuses.at(-1)).toBe("Opening large.csv was cancelled.");
  });
});

it("transfers input to the parsing worker and terminates it on Cancel", async () => {
  const { parseInWorker } = await import("../ui/parse.js");
  let received: { bytes: Uint8Array; name: string } | undefined;
  const worker = {
    terminate: vi.fn(),
    postMessage: vi.fn((message, transfer) => {
      received = structuredClone(message, { transfer });
    }),
    onmessage: (_event: { data: unknown }) => {},
    onerror: (_event: { message: string }) => {},
  };
  const start = vi.fn((_url: URL) => worker);
  const job = new AbortController();
  const sheet = vi.fn();
  const progress = vi.fn();
  const bytes = new TextEncoder().encode("a,b\n1,2\n");
  const result = parseInWorker(
    bytes,
    { name: "large.csv", encoding: "auto" },
    { signal: job.signal, sheet, progress },
    start,
  ).catch((error) => error);
  expect(start.mock.calls[0]?.[0]).toBeInstanceOf(URL);
  expect(bytes.byteLength).toBe(0);
  expect(new TextDecoder().decode(received?.bytes)).toBe("a,b\n1,2\n");
  worker.onmessage({ data: { type: "progress", done: 12, total: 24 } });
  expect(progress).toHaveBeenCalledWith(12, 24);
  job.abort();
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.onmessage({ data: { type: "sheet", sheet: {}, total: 1 } });
  expect(sheet).not.toHaveBeenCalled();
});

it("Cancel during parsing leaves the preceding buffer available", async () => {
  const h = await mounted(8, false);
  await h.host.command("desk.files.visit", A);
  const previous = h.view.shown.at(-1);
  h.open.mockImplementationOnce(
    (_bytes, _file, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")));
      }),
  );
  const next = file("~/Documents/other.csv");
  const pending = h.host.command("desk.files.visit", next).catch((error) => error);
  await vi.waitFor(() => expect(h.open).toHaveBeenCalledTimes(2));
  const state = h.view.progress.mock.calls.at(-1)?.[0];
  expect(state.label).toBe("Parsing");
  state.cancel();
  expect(await pending).toMatchObject({ message: "failed: Opening other.csv was cancelled." });
  expect(h.view.shown.at(-1)).toEqual(previous);
  expect(h.view.statuses.at(-1)).toBe("Opening other.csv was cancelled.");
  await h.host.command("desk.buffers.show", A);
  expect(h.view.shown.at(-1)).toEqual(previous);
});

it("closing a partial workbook cancels it and restores the committed buffer", async () => {
  const { createSheet } = await import("../ui/model.js");
  const h = await mounted(8, false);
  await h.host.command("desk.files.visit", A);
  const previous = h.view.shown.at(-1);
  h.open.mockImplementationOnce(
    (_bytes, _file, { signal, sheet }) =>
      new Promise((_resolve, reject) => {
        sheet({
          kind: "sheets",
          format: "CSV",
          detail: "",
          sheets: [
            createSheet({
              name: "First",
              rows: 1,
              cols: 1,
              cellAt: () => ({ t: "s", v: "ready" }),
            }),
          ],
        });
        signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")));
      }),
  );
  const next = file("~/Documents/partial.csv");
  const pending = h.host.command("desk.files.visit", next).catch((error) => error);
  await vi.waitFor(() => expect(h.view.shown.at(-1)?.name).toBe("partial.csv"));
  await expect(h.host.command("desk.buffers.closed", next)).resolves.toBeUndefined();
  expect(await pending).toMatchObject({ message: "failed: Opening partial.csv was cancelled." });
  expect(h.view.shown.at(-1)).toEqual(previous);
});
