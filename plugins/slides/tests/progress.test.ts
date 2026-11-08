// @vitest-environment jsdom
// Opening a large presentation: ranged reads with progress, the worker for files over 8 MiB (with
// its own XML DOM, as a worker has no DOMParser) that stays to decode pictures, the <desk-progress>
// bar, and Cancel.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineElements } from "../../../packages/ui/src/elements/index";
import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { openFile } from "../ui/open.js";
import { LARGE } from "../ui/slides.js";
import { createView } from "../ui/view.js";
import { handleRequest, XmlDomParser } from "../ui/worker.js";
import { disk, file, type Handlers, mount } from "./harness";
import { odp, page } from "./odp";
import { loadPage } from "./page";
import { pptx, title } from "./pptx";

defineElements();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CHUNK = 2 * 1024 * 1024;
const BIG = file("~/Decks/big.pptx");
const A = file("~/Decks/a.pptx");
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="40" name="Photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>`;

/** A deck of `slides` titled slides, each with the picture, and `pad` stored bytes of video. */
const deckOf = (slides: number, pad = 0) =>
  pptx(
    Array.from({ length: slides }, (_, i) => ({ shapes: `${title(`Slide ${i + 1}`)}${picture}` })),
    pad ? { "ppt/media/media1.mp4": { data: new Uint8Array(pad).fill(9), stored: true } } : {},
  );

/**
 * fs.url for the files of `urls`, answered by a fetch stub with 206 ranges (or, held, never until
 * the read is aborted); the others have no URL and readBytes reads them through fs.read.
 */
function ranged(files: Record<string, Uint8Array>, urls = Object.keys(files), held = false) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const bytes = files[decodeURIComponent(url.slice(url.indexOf("#") + 1))] ?? new Uint8Array();
    const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get("Range") ?? "");
    if (held)
      await new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );
    return new Response(bytes.slice(Number(range?.[1]), Number(range?.[2]) + 1), { status: 206 });
  });
  vi.stubGlobal("fetch", fetcher);
  const handlers: Handlers = {
    ...disk(files),
    "fs.url": ({ path }) => {
      if (!urls.includes(path)) throw new Error("no URL");
      const url = `https://file.invalid/#${encodeURIComponent(path)}`;
      return { url, size: files[path]?.length ?? 0, type: "application/octet-stream" };
    },
  };
  return { fetcher, handlers };
}

/** startWorker for tests: ui/worker.js's handler in this thread, with the worker's XML DOM. */
function fakeWorkers(options: { hold?: boolean } = {}) {
  const started: Array<{ url: string; name?: string }> = [];
  const requests: string[] = [];
  let terminated = 0;
  const startWorker = (url: string | URL, init: { name?: string } = {}) => {
    started.push({ url: String(url), name: init.name });
    let closed = false;
    const held = {};
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      terminate: () => {
        closed = true;
        terminated++;
      },
      postMessage(data: { type: "open" | "image" }, transfer: ArrayBuffer[] = []) {
        const moved = structuredClone(data, { transfer }) as Parameters<typeof handleRequest>[0];
        requests.push(moved.type === "open" ? `open ${moved.bytes.length}` : `image ${moved.id}`);
        if (options.hold && moved.type === "open") return;
        const Native = globalThis.DOMParser;
        globalThis.DOMParser = XmlDomParser as unknown as typeof DOMParser;
        const replies: unknown[] = [];
        void handleRequest(moved, (m) => replies.push(structuredClone(m)), held).finally(() => {
          globalThis.DOMParser = Native;
          for (const reply of replies) if (!closed) worker.onmessage?.({ data: reply });
        });
      },
    };
    return worker as unknown as Worker;
  };
  return { startWorker, started, requests, terminated: () => terminated };
}

describe("reading in ranges", () => {
  it("reads through fs.url in 2 MiB ranges and reports the bytes after each one", async () => {
    const bytes = deckOf(2, CHUNK);
    const { fetcher, handlers } = ranged({ [A.path]: bytes });
    const { host, view, params } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    expect(params("fs.read")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const reading = view.phases.filter((p) => p?.label === "Reading" && p.value !== null);
    expect(reading.map((p) => p?.value)).toEqual([CHUNK, bytes.length]);
    expect(reading.at(-1)?.detail).toBe(
      `${bytes.length.toLocaleString("en-US")} of ${bytes.length.toLocaleString("en-US")} bytes`,
    );
    const labels = view.phases.map((p) => p?.label ?? null);
    expect(labels.filter((l, i) => l !== labels[i - 1])).toEqual(["Reading", "Opening", null]);
    expect(view.statuses).toEqual(["Opening a.pptx…", "a.pptx: 2 slides."]);
  }, 20_000);
});

describe("a file over 8 MiB", () => {
  it("opens in a worker that stays to decode its pictures, and ends when the file closes", async () => {
    const bytes = deckOf(90, LARGE);
    const expected = await openFile(bytes.slice(), "big.pptx");
    const workers = fakeWorkers();
    const { host, view } = await mount({ handlers: disk({ [BIG.path]: bytes }), ...workers });
    await host.command("desk.files.visit", BIG);
    expect(workers.started).toEqual([
      { url: expect.stringMatching(/\/ui\/worker\.js$/), name: "Slides reader" },
    ]);
    expect(workers.requests).toEqual([`open ${bytes.length}`]);
    const opened = view.shown.at(-1)?.opened;
    if (opened?.kind !== "deck" || expected.kind !== "deck") throw new Error("not a deck");
    // Ninety slides came in parts; the deck is the one the main thread would have read.
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    expect(plain(opened.deck)).toEqual(plain(expected.deck));
    const url = await opened.deck.image("ppt/media/image1.png");
    expect(url).toBe(await expected.deck.image("ppt/media/image1.png"));
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(workers.requests).toEqual([`open ${bytes.length}`, "image ppt/media/image1.png"]);
    expect(workers.terminated()).toBe(0);
    await host.command("desk.buffers.closed", { buffer: BIG.buffer });
    expect(workers.terminated()).toBe(1);
  }, 20_000);

  it("a small file stays on the main thread", async () => {
    const workers = fakeWorkers();
    const { host, view } = await mount({ handlers: disk({ [A.path]: deckOf(1) }), ...workers });
    await host.command("desk.files.visit", A);
    expect(workers.started).toEqual([]);
    expect(view.shown.at(-1)).toMatchObject({ opened: { kind: "deck" } });
  });

  it("the worker's XML DOM reads every XML format as the browser's DOMParser does", async () => {
    const fixture = (name: string) =>
      new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
    const files: Array<[string, Uint8Array]> = [
      ["made.pptx", deckOf(3)],
      ["made.odp", odp(page("One", "") + page("Two", ""))],
      ...["sample.pptx", "sample-lo.pptx", "sample.odp", "ppt/deck.pptx"].map(
        (name) => [name, fixture(name)] as [string, Uint8Array],
      ),
    ];
    const Native = globalThis.DOMParser;
    for (const [name, bytes] of files) {
      const native = await openFile(bytes.slice(), name);
      globalThis.DOMParser = XmlDomParser as unknown as typeof DOMParser;
      const worker = await openFile(bytes.slice(), name).finally(() => {
        globalThis.DOMParser = Native;
      });
      expect(JSON.stringify(worker), name).toBe(JSON.stringify(native));
    }
  }, 20_000);
});

describe("Cancel", () => {
  it("stops the read, keeps the deck on screen and says so", async () => {
    const B = file("~/Decks/b.pptx");
    const files = { [A.path]: deckOf(1), [B.path]: deckOf(1, CHUNK * 2) };
    const { fetcher, handlers } = ranged(files, [B.path], true);
    const { host, view } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    const before = view.shown.length;
    const visit = host.command("desk.files.visit", B);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    view.cancel();
    await expect(visit).rejects.toThrow("Opening b.pptx was cancelled.");
    expect(view.shown.length).toBe(before);
    expect(view.phases.at(-1)).toBeNull();
    expect(view.statuses.at(-1)).toBe("Opening b.pptx was cancelled.");
  });

  it("ends the worker of a large file", async () => {
    const workers = fakeWorkers({ hold: true });
    const bytes = deckOf(1, LARGE);
    const { host, view } = await mount({ handlers: disk({ [BIG.path]: bytes }), ...workers });
    const visit = host.command("desk.files.visit", BIG);
    await vi.waitFor(() => expect(workers.started).toHaveLength(1));
    expect(view.phases.at(-1)).toMatchObject({ label: "Opening", value: null });
    view.cancel();
    await expect(visit).rejects.toThrow("Opening big.pptx was cancelled.");
    expect(workers.terminated()).toBe(1);
    expect(view.shown.at(-1)).toBeNull();
  }, 20_000);
});

describe("the bar", () => {
  it("shows after 300 ms, follows the phases, offers Cancel and hides at the end", async () => {
    vi.useFakeTimers();
    loadPage();
    const view = createView(document);
    const bar = document.querySelector("desk-progress") as DeskProgress;
    expect(bar.hidden).toBe(true);
    const cancel = vi.fn();
    view.progress({ label: "Reading", value: 12, max: 48, detail: "12 of 48 bytes", cancel });
    await vi.advanceTimersByTimeAsync(299);
    expect(bar.shown).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(bar.shown).toBe(true);
    expect([bar.label, bar.value, bar.max, bar.detail]).toEqual([
      "Reading",
      12,
      48,
      "12 of 48 bytes",
    ]);
    view.progress({ label: "Opening", value: null, max: 1, detail: "a.pptx", cancel });
    expect(bar.indeterminate).toBe(true);
    bar.shadowRoot?.querySelector("button")?.click();
    expect(cancel).toHaveBeenCalledOnce();
    view.progress(null);
    expect(bar.hidden).toBe(true);
  });
});
