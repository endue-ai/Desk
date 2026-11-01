// @vitest-environment jsdom
// DjVu books through endue.formats' decoder: pages laid out at their size and resolution, drawn to
// canvases at the zoom in use, the outline as the contents, search in the hidden text; decoding in a
// worker started with the SDK's startWorker, or in the frame when no worker starts.
import { createHash } from "node:crypto";
import { openDjvu } from "@endue-ai/formats/djvu/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDjvuHandler, libraryUrl } from "../ui/djvu-worker.js";
import { openBook } from "../ui/open.js";
import { createView } from "../ui/view.js";
import { counted, library } from "./build/comic-archives";
import { disk, file, loadPage, mount } from "./harness";

type Raster = { width: number; height: number; rgba?: Uint8Array };
type Djvu = {
  kind: "pages";
  format: string;
  title: string;
  pages: Array<{ width: number; height: number }>;
  toc: unknown[];
  text(i: number): Promise<string>;
  paint(i: number, host: HTMLElement, zoom: number, hooks: object): Promise<void>;
  raster(i: number, scale: number, signal?: AbortSignal): Promise<Raster>;
  close?(): unknown;
};

const BOOK = file("~/Books/book.djvu");
const hooks = { go() {}, external() {} };
const sha = (bytes: Uint8Array | undefined) =>
  createHash("sha256")
    .update(bytes ?? new Uint8Array())
    .digest("hex");
const djvu = async (bytes: Uint8Array | ReturnType<typeof counted>, options: object = {}) => {
  const book = await openBook(bytes, { name: "book.djvu", path: BOOK.path, ...options });
  if (book.kind !== "pages") throw new Error(`opened as ${JSON.stringify(book)}`);
  return book as unknown as Djvu;
};
const libraryPage = async (i: number, scale: number) => {
  const bytes = library("djvu/book.djvu");
  const doc = await openDjvu({ size: bytes.length, read: async (o, l) => bytes.slice(o, o + l) });
  return doc.renderPage(i, { scale });
};

/** A worker on this thread: the module's handler, with the ready message the module posts. */
class LocalWorker extends EventTarget {
  terminated = false;
  #handle = createDjvuHandler((data: unknown) => this.#send(data), openDjvu);
  constructor() {
    super();
    this.#send({ type: "ready" });
  }
  #send(data: unknown) {
    queueMicrotask(() => {
      if (!this.terminated) this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  postMessage(data: unknown) {
    queueMicrotask(() => void this.#handle(data));
  }
  terminate() {
    this.terminated = true;
  }
}

describe("DjVu", () => {
  beforeEach(() => document.body.replaceChildren());

  it("a bundled multi-page DjVu opens with its page count, sizes and outline", async () => {
    const book = await djvu(library("djvu/book.djvu"));
    expect(book).toMatchObject({ format: "DjVu", title: "A test book" });
    // 100% is the printed size: 96 CSS pixels an inch, from each page's own resolution.
    expect(book.pages).toEqual([
      { width: 384, height: 256 },
      { width: 307.2, height: 204.8 },
      { width: 230.4, height: 307.2 },
    ]);
    expect(book.toc).toEqual([
      { title: "Cover", unit: 0, children: [] },
      { title: "Chapter one", unit: 1, children: [{ title: "A section", unit: 2, children: [] }] },
    ]);
  });

  it("page 2 renders through the library, at the zoom in use, with its text beside it", async () => {
    const book = await djvu(library("djvu/book.djvu"));
    const host = document.createElement("section");
    await book.paint(1, host, 1, hooks);
    const canvas = host.querySelector("canvas");
    expect([canvas?.width, canvas?.height]).toEqual([307, 205]);
    expect(host.querySelector(".page-text")?.textContent).toBe("Grüße 한글\ncolours");
    await book.paint(1, host, 2, hooks);
    expect([host.querySelector("canvas")?.width, host.querySelector("canvas")?.height]).toEqual([
      480, 320,
    ]);
    const raster = await book.raster(1, 0.64);
    expect(sha(raster.rgba)).toBe(sha((await libraryPage(1, 0.64)).rgba));
  });

  it("search finds a word from its text layer", async () => {
    loadPage(document);
    const action = () => {};
    const { host, settle } = await mount({
      handlers: disk({ [BOOK.path]: library("djvu/book.djvu") }),
      view: () =>
        createView(document, {
          moved: action,
          zoomed: action,
          bookmark: action,
          note: action,
          forget: action,
          unlock: action,
        }),
    });
    await host.command("desk.files.visit", BOOK);
    await settle();
    expect(document.querySelectorAll("#pages .page")).toHaveLength(3);
    (document.getElementById("find-toggle") as HTMLButtonElement).click();
    (document.getElementById("find-text") as HTMLInputElement).value = "colours";
    document.getElementById("find")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("find-status")?.textContent).toBe("Page 2: match 1 of 1"),
    );
    expect(document.querySelector('#pages [data-unit="1"] mark.hit')?.textContent).toBe("colours");
  });

  it("decodes in a worker that imports the library by its URL on the plugin scheme", async () => {
    const started: URL[] = [];
    const workers: LocalWorker[] = [];
    const startWorker = (url: URL) => {
      started.push(url);
      const worker = new LocalWorker();
      workers.push(worker);
      return worker;
    };
    const book = await djvu(library("djvu/book.djvu"), { startWorker });
    expect(started[0]?.href).toMatch(/\/ui\/djvu-worker\.js$/);
    expect(book.pages).toHaveLength(3);
    expect(await book.text(1)).toBe("Grüße 한글\ncolours");
    expect(sha((await book.raster(1, 0.64)).rgba)).toBe(sha((await libraryPage(1, 0.64)).rgba));
    await book.close?.();
    expect(workers[0]?.terminated).toBe(true);
    expect(libraryUrl("desk-plugin://localhost/endue.reader/ui/djvu-worker.js")).toBe(
      "desk-plugin://localhost/endue.formats/lib/djvu/index.js",
    );
    expect(libraryUrl("http://desk-plugin.localhost/endue.reader/ui/djvu-worker.js")).toBe(
      "http://desk-plugin.localhost/endue.formats/lib/djvu/index.js",
    );
  });

  it("decodes in the frame when the worker cannot start", async () => {
    const failing = () => {
      const worker = new EventTarget() as EventTarget & { terminate(): void };
      worker.terminate = vi.fn();
      queueMicrotask(() => worker.dispatchEvent(new Event("error")));
      return worker;
    };
    const book = await djvu(library("djvu/book.djvu"), { startWorker: failing });
    expect(await book.text(0)).toBe("Hello pages\nsecond line");
  });

  it("Cancel stops a page's decoding", async () => {
    const book = await djvu(library("djvu/big.djvu"), { name: "big.djvu" });
    const stop = new AbortController();
    const drawing = book.raster(0, 1, stop.signal).catch((error) => error);
    stop.abort();
    expect(await drawing).toMatchObject({ name: "AbortError" });
  });

  it("opens a bundled document without reading it whole", async () => {
    const source = counted(library("djvu/book.djvu"));
    const book = await djvu(source);
    expect(book.pages).toHaveLength(3);
    // Beyond the reader's first 4 KiB, which name the format: the directory and each page's head.
    const [sniff, ...rest] = source.reads;
    expect(sniff).toEqual([0, 4096]);
    expect(rest.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(source.size / 4);
  });

  it("a damaged DjVu opens the details view with the library's sentence", async () => {
    const bytes = library("djvu/book.djvu");
    bytes.set(new TextEncoder().encode("XXXX"), 4);
    const book = await openBook(bytes, { name: "damaged.djvu", path: "~/damaged.djvu" });
    expect(book).toMatchObject({
      kind: "details",
      format: "DjVu",
      why: "This is not a DjVu file: it does not start with an IFF FORM.",
    });
  });
});
