// @vitest-environment jsdom
// Reading in ranges with progress, the delayed progress bar with Cancel, pages over the slice size
// parsed and drawn a slice at a time, and large archives opened in a worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineElements } from "../../../packages/ui/src/elements/index";
import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { createView } from "../ui/view.js";
import { createServer } from "../ui/worker.js";
import { PNG, pngData } from "./build";
import { disk, file, type Handlers, loadPage, mount, type Progress } from "./harness";

defineElements();

const CHUNK = 2 * 1024 * 1024;
const A = file("~/Sites/a.html");
const B = file("~/Sites/b.html");
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const shadow = () => byId("page").shadowRoot as ShadowRoot;

beforeEach(() => loadPage(document));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** fetch answering Range requests over in-memory files by the fs.url URL's path. */
function ranges(files: Record<string, Uint8Array>, hold?: Promise<void>) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const bytes = files[decodeURIComponent(String(url).slice("https://file.invalid/".length))];
    if (!bytes) return new Response(null, { status: 404 });
    const range = /bytes=(\d+)-(\d+)/u.exec((init.headers as Record<string, string>).Range ?? "");
    const start = Number(range?.[1]);
    if (hold && start > 0)
      await new Promise<void>((resolve, reject) => {
        hold.then(resolve);
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    return new Response(bytes.slice(start, Number(range?.[2]) + 1), { status: 206 });
  });
  vi.stubGlobal("fetch", fetcher);
  return {
    fetcher,
    handlers: {
      "fs.url": ({ path }) => {
        const bytes = files[path];
        if (!bytes) throw new Error("no such file");
        const url = `https://file.invalid/${encodeURIComponent(path)}`;
        return { url, size: bytes.length, type: "text/html" };
      },
      "fs.watch": () => ({ watchId: "w" }),
    } satisfies Handlers,
  };
}

const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const labels = (progress: Progress[]) => progress.map((p) => p?.label ?? null);

describe("the progress bar", () => {
  it("shows after 300 ms, keeps one element across phases, cancels and hides", async () => {
    vi.useFakeTimers();
    const view = createView(document, { open() {}, external() {}, say() {} });
    const bar = document.querySelector("desk-progress") as DeskProgress;
    expect(bar, "the page has the shared progress element").not.toBeNull();
    expect(bar.hidden).toBe(true);
    const cancel = vi.fn();
    view.progress({ label: "Reading", value: 12, max: 24, detail: "12 of 24 bytes", cancel });
    await vi.advanceTimersByTimeAsync(299);
    expect(bar.shown).toBe(false);
    view.progress({ label: "Parsing", value: 1, max: 4, detail: "", cancel });
    await vi.advanceTimersByTimeAsync(1);
    expect(bar.shown).toBe(true);
    expect([bar.label, bar.value, bar.max, bar.cancelable]).toEqual(["Parsing", 1, 4, true]);
    bar.shadowRoot?.querySelector("button")?.click();
    expect(cancel).toHaveBeenCalledOnce();
    view.progress(null);
    expect(bar.hidden).toBe(true);
  });
});

describe("reading with progress", () => {
  it("reads through fs.url in 2 MiB ranges and reports every chunk", async () => {
    const page = utf8(`<p>${"x".repeat(CHUNK * 2)}</p>`);
    const { fetcher, handlers } = ranges({ [A.path]: page });
    const { host, view, params } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    expect(params("fs.read")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const reading = view.progresses.filter((p) => p?.label === "Reading" && p.value);
    expect(reading.map((p) => p?.value)).toEqual([CHUNK, CHUNK * 2, page.length]);
    expect(reading.at(-1)?.detail).toBe(
      `${page.length.toLocaleString("en-US")} of ${page.length.toLocaleString("en-US")} bytes`,
    );
    expect(view.progresses.at(-1)).toBeNull();
    expect(view.shown.at(-1)).toMatchObject({ ...A, size: page.length, model: { kind: "page" } });
  });

  it("Cancel stops the read and keeps the file that was on screen", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const big = utf8(`<p>${"y".repeat(CHUNK * 3)}</p>`);
    const { fetcher, handlers } = ranges({ [A.path]: utf8("<p>A</p>"), [B.path]: big }, hold);
    const { host, view } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    const shownBefore = view.shown.length;
    const visit = host.command("desk.files.visit", B);
    await vi.waitFor(() => expect(view.progresses.at(-1)?.label).toBe("Reading"));
    view.progresses.at(-1)?.cancel();
    await expect(visit).rejects.toThrow("Opening b.html was cancelled.");
    release();
    expect(view.shown.slice(shownBefore).every((s) => s?.path === A.path)).toBe(true);
    expect(view.statuses.at(-1)).toBe("Opening b.html was cancelled.");
    expect(view.progresses.at(-1)).toBeNull();
    const asked = fetcher.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetcher.mock.calls.length).toBe(asked);
    await expect(host.command("desk.buffers.show", B)).rejects.toThrow(`No file ${B.buffer}.`);
  });
});

describe("large pages", () => {
  const LARGE = `<!doctype html><title>Large</title><h1>Large</h1>${"<p>row <a href='#end'>end</a></p>".repeat(1500)}<p id="end">End</p>`;

  /** The real view, with a small slice size, recording what it puts on the progress bar. */
  const sliced = (actions: Parameters<typeof createView>[1], seen: Progress[]) => {
    const view = createView(document, actions, { sliceOver: 1000 });
    const progress = view.progress;
    view.progress = (value: Progress) => {
      seen.push(value);
      progress(value);
    };
    return view;
  };

  it("parse and draw a page over the slice size a slice at a time, with progress", async () => {
    const seen: Progress[] = [];
    const { host } = await mount({
      handlers: disk({ [A.path]: LARGE }),
      view: (actions) => sliced(actions, seen),
    });
    await host.command("desk.files.visit", A);
    expect(labels(seen)).toEqual(expect.arrayContaining(["Reading", "Parsing", "Drawing"]));
    const drawing = seen.filter((p) => p?.label === "Drawing");
    expect(drawing.length).toBeGreaterThan(1);
    expect(drawing.every((p) => p && p.value !== null && p.value <= p.max)).toBe(true);
    expect(seen.at(-1)).toBeNull();
    expect(shadow().querySelectorAll("p")).toHaveLength(1501);
    expect(byId("file-name").textContent).toBe("a.html");
  });

  it("a huge page opens with its first part; a jump past it copies the rest first", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { host, settle } = await mount({
      handlers: disk({ [A.path]: LARGE }),
      view: (actions) => createView(document, actions, { sliceOver: 1000, first: 1200 }),
    });
    await host.command("desk.files.visit", A);
    const drawn = shadow().querySelectorAll("p").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(1501);
    expect(shadow().getElementById("end")).toBeNull();
    const link = shadow().querySelector("a[href='#end']");
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
    );
    await vi.waitFor(() => expect(shadow().getElementById("end")).not.toBeNull(), 10000);
    await settle();
    expect(shadow().querySelectorAll("p")).toHaveLength(1501);
    const target = vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as Element;
    expect(target.id).toBe("end");
  });

  it("Cancel while a page draws puts the previous file back", async () => {
    const seen: Progress[] = [];
    const { host } = await mount({
      handlers: disk({ [A.path]: "<p id='small'>Small</p>", [B.path]: LARGE }),
      view: (actions) => sliced(actions, seen),
    });
    await host.command("desk.files.visit", A);
    const visit = host.command("desk.files.visit", B);
    await vi.waitFor(() => expect(seen.at(-1)?.label).toBe("Drawing"));
    seen.at(-1)?.cancel();
    await expect(visit).rejects.toThrow("Opening b.html was cancelled.");
    expect(byId("file-name").textContent).toBe("a.html");
    expect(shadow().getElementById("small")?.textContent).toBe("Small");
    expect(shadow().querySelectorAll("p")).toHaveLength(1);
  });
});

describe("large archives in a worker", () => {
  const MHTML = [
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; type="text/html"; boundary="b"',
    "",
    "--b",
    "Content-Type: text/html",
    "Content-Location: https://example.com/page",
    "",
    `<p>Archived</p><img src="dot.png" alt="dot">${"<!-- padding -->".repeat(100)}`,
    "--b",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-Location: https://example.com/dot.png",
    "",
    PNG.toString("base64"),
    "--b--",
    "",
  ].join("\r\n");
  const M = file("~/Saved/page.mhtml");

  /** startWorker for tests: the worker module served in this thread, messages cloned. */
  function workers() {
    const started: Array<{ url: string; terminated: boolean }> = [];
    const startWorker = vi.fn((url: URL) => {
      const listeners: Array<(event: MessageEvent) => void> = [];
      const worker = {
        url: String(url),
        terminated: false,
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null,
        addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
          if (type === "message") listeners.push(listener);
        },
        removeEventListener() {},
        postMessage: (data: unknown) => {
          const copy = structuredClone(data);
          setTimeout(() => !worker.terminated && serve(copy as Parameters<typeof serve>[0]));
        },
        terminate: () => {
          worker.terminated = true;
        },
      };
      const serve = createServer((message: unknown) => {
        const copy = structuredClone(message);
        setTimeout(() => {
          if (worker.terminated) return;
          const event = { data: copy } as MessageEvent;
          worker.onmessage?.(event);
          for (const listener of listeners) listener(event);
        });
      });
      started.push(worker);
      return worker as unknown as Worker;
    });
    return { startWorker, started };
  }

  it("an archive over the worker size opens in a worker, its resources read through it", async () => {
    const { startWorker, started } = workers();
    const { host } = await mount({
      handlers: disk({ [M.path]: MHTML }),
      view: (actions) => createView(document, actions),
      options: { startWorker, workerOver: 1000 },
    });
    await host.command("desk.files.visit", M);
    expect(startWorker).toHaveBeenCalledOnce();
    expect(started[0]?.url).toMatch(/\/ui\/worker\.js$/);
    expect(shadow().querySelector("p")?.textContent).toBe("Archived");
    expect(shadow().querySelector("img")?.getAttribute("src")).toBe(pngData);
    expect(started[0]?.terminated).toBe(false);
    await host.command("desk.buffers.closed", { buffer: M.buffer });
    expect(started[0]?.terminated).toBe(true);
  });

  it("a small file never starts a worker", async () => {
    const { startWorker } = workers();
    const { host } = await mount({
      handlers: disk({ [M.path]: MHTML }),
      options: { startWorker },
    });
    await host.command("desk.files.visit", M);
    expect(startWorker).not.toHaveBeenCalled();
  });
});
