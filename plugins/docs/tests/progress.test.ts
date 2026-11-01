// @vitest-environment jsdom
// Opening a large document: ranged reads with progress, the worker for files over 8 MiB (with its
// own XML DOM, as a worker has no DOMParser), the <desk-progress> bar, and Cancel.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineElements } from "../../../packages/ui/src/elements/index";
import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { LARGE } from "../ui/docs.js";
import type { DocModel } from "../ui/model.js";
import { openDocument } from "../ui/open.js";
import { createView } from "../ui/view/view.js";
import { handleOpen, XmlDomParser } from "../ui/worker.js";
import { makeAbw, makeFodt, makeOdt, makeSxw } from "./fixtures";
import { disk, file, mount } from "./harness";
import { makeHwpx } from "./hwp";
import { asDocument, texts } from "./model";
import { makeDocx } from "./ooxml-fixture";
import { makeZip, utf8 } from "./zip";

defineElements();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CHUNK = 2 * 1024 * 1024;
const A = file("~/Documents/a.rtf");
const BIG = file("~/Documents/big.docx");
const rtf = (text: string) => utf8(`{\\rtf1\\ansi ${text}\\par}`);

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
  const handlers = {
    ...disk(files),
    "fs.url": ({ path }: { path: string }) => {
      if (!urls.includes(path)) throw new Error("no URL");
      const url = `https://file.invalid/#${encodeURIComponent(path)}`;
      return { url, size: files[path]?.length ?? 0 };
    },
  };
  return { fetcher, handlers };
}

/** A Word document of more than 8 MiB: many paragraphs, a link, and a stored picture's bytes. */
async function bigDocx() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const body = Array.from({ length: 1200 }, (_, i) => `<w:p><w:r><w:t>Line ${i}</w:t></w:r></w:p>`);
  const link = `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>the report</w:t></w:r></w:hyperlink></w:p>`;
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return makeZip(
    {
      "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/document.xml": `<?xml version="1.0"?><w:document ${W} ${R}><w:body>${link}${body.join("")}</w:body></w:document>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.com/report" TargetMode="External"/></Relationships>`,
      "word/media/scan.bin": new Uint8Array(LARGE + 1024).fill(7),
    },
    ["word/media/scan.bin"],
  );
}

/** startWorker for tests: ui/worker.js's handler in this thread, with the worker's XML DOM. */
function fakeWorkers(options: { hold?: boolean } = {}) {
  const started: Array<{ url: string; name?: string }> = [];
  const received: number[] = [];
  let terminated = 0;
  const startWorker = (url: string | URL, init: { name?: string } = {}) => {
    started.push({ url: String(url), name: init.name });
    let closed = false;
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      terminate: () => {
        closed = true;
        terminated++;
      },
      postMessage(data: { bytes: Uint8Array; path: string }, transfer: ArrayBuffer[]) {
        const moved = structuredClone(data, { transfer });
        received.push(moved.bytes.length);
        if (options.hold) return;
        const Native = globalThis.DOMParser;
        globalThis.DOMParser = XmlDomParser as unknown as typeof DOMParser;
        const replies: unknown[] = [];
        void handleOpen(moved, (message) => replies.push(structuredClone(message))).finally(() => {
          globalThis.DOMParser = Native;
          for (const reply of replies) if (!closed) worker.onmessage?.({ data: reply });
        });
      },
    };
    return worker as unknown as Worker;
  };
  return { startWorker, started, received, terminated: () => terminated };
}

describe("reading in ranges", () => {
  it("reads through fs.url in 2 MiB ranges and reports the bytes after each one", async () => {
    const bytes = rtf("A line of words.\\par\n".repeat((CHUNK + 4096) / 18));
    const { fetcher, handlers } = ranged({ [A.path]: bytes });
    const { host, view, params } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    expect(params("fs.url")).toHaveLength(1);
    expect(params("fs.read")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const reading = view.phases.filter((p) => p?.label === "Reading" && p.value !== null);
    expect(reading.map((p) => p?.value)).toEqual([CHUNK, bytes.length]);
    expect(reading.at(-1)).toMatchObject({
      max: bytes.length,
      detail: expect.stringMatching(/ bytes$/),
    });
    expect(view.phases.map((p) => p?.label ?? null).filter((l, i, a) => l !== a[i - 1])).toEqual([
      "Reading",
      "Opening",
      null,
    ]);
    expect(view.shown.at(-1)).toMatchObject({ size: bytes.length, doc: { kind: "document" } });
  });
});

describe("a file over 8 MiB", () => {
  it("opens in a worker: the bytes move there and the model comes back whole, in parts", async () => {
    const bytes = await bigDocx();
    expect(bytes.length).toBeGreaterThan(LARGE);
    const expected = asDocument(await openDocument(bytes.slice(), BIG.path));
    const workers = fakeWorkers();
    const open = vi.fn(openDocument);
    const { host, view } = await mount({ handlers: disk({ [BIG.path]: bytes }), ...workers, open });
    await host.command("desk.files.visit", BIG);
    expect(workers.started).toEqual([
      { url: expect.stringMatching(/\/ui\/worker\.js$/), name: "Docs reader" },
    ]);
    expect(workers.received).toEqual([bytes.length]);
    expect(workers.terminated()).toBe(1);
    expect(open).not.toHaveBeenCalled();
    const doc = asDocument(view.shown.at(-1)?.doc as DocModel);
    expect(doc).toEqual(expected);
    expect(texts(doc)).toHaveLength(1201);
    expect(view.shown.at(-1)).toMatchObject({ size: bytes.length });
  });

  it("a small file stays on the main thread", async () => {
    const workers = fakeWorkers();
    const { host, view } = await mount({ handlers: disk({ [A.path]: rtf("Alpha") }), ...workers });
    await host.command("desk.files.visit", A);
    expect(workers.started).toEqual([]);
    expect(view.shown.at(-1)).toMatchObject({ doc: { kind: "document" } });
  });

  it("the worker's XML DOM reads every XML format as the browser's DOMParser does", async () => {
    const fixture = (name: string) =>
      new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
    const files: Array<[string, Uint8Array]> = [
      ["made.docx", await makeDocx()],
      ["made.odt", await makeOdt()],
      ["made.sxw", await makeSxw()],
      ["made.fodt", makeFodt()],
      ["made.abw", makeAbw()],
      ["made.hwpx", await makeHwpx()],
      ...[
        "rich.docx",
        "rich.odt",
        "rich.fodt",
        "rich.abw",
        "doc/format.docx",
        "doc/format.fodt",
      ].map((name) => [name, fixture(name)] as [string, Uint8Array]),
      ["broken.fodt", utf8('<?xml version="1.0"?><office:document xmlns:office="urn:x"><a></b>')],
    ];
    const Native = globalThis.DOMParser;
    for (const [name, bytes] of files) {
      const native = await openDocument(bytes.slice(), `~/${name}`);
      globalThis.DOMParser = XmlDomParser as unknown as typeof DOMParser;
      const worker = await openDocument(bytes.slice(), `~/${name}`).finally(() => {
        globalThis.DOMParser = Native;
      });
      expect(worker, name).toEqual(native);
    }
  });
});

describe("Cancel", () => {
  it("stops the read, keeps the document on screen and says so", async () => {
    const B = file("~/Documents/b.rtf");
    const files = { [A.path]: rtf("Alpha"), [B.path]: rtf("x".repeat(CHUNK * 3)) };
    const { fetcher, handlers } = ranged(files, [B.path], true);
    const { host, view } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    const before = view.shown.length;
    const visit = host.command("desk.files.visit", B);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    view.cancel();
    await expect(visit).rejects.toThrow("Opening b.rtf was cancelled.");
    expect(view.shown.length).toBe(before);
    expect(view.phases.at(-1)).toBeNull();
    expect(view.statuses.at(-1)).toBe("Opening b.rtf was cancelled.");
  });

  it("ends the worker of a large file", async () => {
    const bytes = await bigDocx();
    const workers = fakeWorkers({ hold: true });
    const { host, view } = await mount({ handlers: disk({ [BIG.path]: bytes }), ...workers });
    const visit = host.command("desk.files.visit", BIG);
    await vi.waitFor(() => expect(workers.started).toHaveLength(1));
    expect(view.phases.at(-1)).toMatchObject({ label: "Opening", value: null });
    view.cancel();
    await expect(visit).rejects.toThrow("Opening big.docx was cancelled.");
    expect(workers.terminated()).toBe(1);
    expect(view.shown.at(-1)).toBeNull();
  });
});

describe("the bar", () => {
  it("shows after 300 ms, follows the phases, offers Cancel and hides at the end", async () => {
    vi.useFakeTimers();
    const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
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
    view.progress({ label: "Opening", value: null, max: 1, detail: "a.docx", cancel });
    expect(bar.indeterminate).toBe(true);
    bar.shadowRoot?.querySelector("button")?.click();
    expect(cancel).toHaveBeenCalledOnce();
    view.progress(null);
    expect(bar.hidden).toBe(true);
    expect(bar.shown).toBe(false);
  });
});
