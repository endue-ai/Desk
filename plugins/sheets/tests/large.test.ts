import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createSheets } from "../ui/sheets.js";
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
        return { url: "https://file.invalid/token", size };
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
  const open = vi.fn((_bytes: Uint8Array) => ({
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
        createSheets(ctx, h.view, { open: h.open });
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
    expect(await pending).toMatchObject({ message: "Opening large.csv was cancelled." });
    expect(signal?.aborted).toBe(true);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.view.shown.at(-1)).toBeNull();
    expect(h.view.statuses.at(-1)).toBe("Opening large.csv was cancelled.");
  });
});
