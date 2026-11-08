// PDF through the vendored pdf.js. Random-access input uses its range transport, and the browser
// supplies an owned real worker (or the existing in-frame fallback when it cannot start).

import { PasswordNeeded, Unreadable } from "./errors.js";
import { pdfRange } from "./pdf-range.js";

export { PasswordNeeded };

/**
 * @typedef {import("./imagesize.js").Size} Size
 * @typedef {import("./toc.js").Toc} Toc
 * @typedef {{ rect: number[], unit?: number, url?: string }} Link
 * @typedef {{ getDocument(params: object): { promise: Promise<any>, destroy(): Promise<void> } }} Pdfjs
 */

/** CSS pixels per PDF point: 100% shows a page at its printed size. */
export const CSS_PER_POINT = 96 / 72;

const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** What getDocument is asked: everything the frame's CSP would refuse stays off. */
const params = (/** @type {object} */ input, /** @type {string | undefined} */ password) => ({
  ...input,
  ...(password === undefined ? {} : { password }),
  isEvalSupported: false,
  useSystemFonts: true,
  useWorkerFetch: false,
  useWasm: false,
  enableXfa: false,
  rangeChunkSize: 65536,
  disableStream: true,
  disableAutoFetch: true,
  enableHWA: false,
  verbosity: 0,
});

/**
 * A page's text items, read from pdf.js's stream with a reader: getTextContent iterates the stream
 * with for await, which WebKit's ReadableStream does not offer.
 * @param {any} page
 * @returns {Promise<Array<{ str?: string, hasEOL?: boolean }>>}
 */
async function textContent(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  for (let next = await reader.read(); !next.done; next = await reader.read())
    items.push(...(next.value?.items ?? []));
  return items;
}

/**
 * @param {Uint8Array | import("@endue-ai/plugin-sdk").ByteSource} bytes
 * @param {{ pdfjs: Pdfjs | object, password?: string, signal?: AbortSignal }} options
 */
export async function openPdf(bytes, { pdfjs, password, signal }) {
  const lib = /** @type {any} */ (pdfjs);
  signal?.throwIfAborted();
  const own = await lib.createWorker?.(signal);
  if (signal?.aborted) {
    own?.close();
    signal.throwIfAborted();
  }
  let fail;
  let task;
  let closed;
  const failed = new Promise((_, reject) => {
    fail = reject;
  });
  const guarded = (operation) => Promise.race([failed, operation]);
  let stopped = false;
  const stop = (error) => {
    if (stopped) return;
    stopped = true;
    fail(error);
    bytes.cancel?.(error);
    void close().catch(() => {});
  };
  const range = bytes instanceof Uint8Array ? undefined : pdfRange(lib, bytes, signal, stop);
  const abort = () => stop(signal.reason);
  const close = () => {
    if (closed) return closed;
    signal?.removeEventListener("abort", abort);
    range?.abort();
    closed = Promise.resolve(task?.destroy()).finally(() => own?.close());
    return closed;
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const input =
      bytes instanceof Uint8Array ? { data: bytes.slice() } : { range, length: bytes.size };
    task = lib.getDocument(params({ ...input, ...(own ? { worker: own.worker } : {}) }, password));
    const doc = await guarded(task.promise);
    const book = await describePdf(doc, close, guarded);
    const beginDecode = (signal) => {
      const cancel = () => stop(signal.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      return () => signal?.removeEventListener("abort", cancel);
    };
    return {
      ...book,
      guard: guarded,
      beginDecode,
      stopped: () => stopped,
      async measure(i, /** @type {AbortSignal | undefined} */ signal = undefined) {
        const release = beginDecode(signal);
        try {
          return await book.measure(i);
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    await close().catch(() => {});
    if (signal?.aborted || error?.name === "AbortError") throw error;
    const { name, code, message } =
      /** @type {{ name?: string, code?: number, message?: string }} */ (error ?? {});
    if (name === "PasswordException") throw new PasswordNeeded(code === 2);
    if (name === "InvalidPDFException")
      throw new Unreadable("The PDF is damaged: its structure cannot be read.", { format: "PDF" });
    throw new Unreadable(`The PDF cannot be opened: ${message ?? name ?? "unknown error"}.`, {
      format: "PDF",
    });
  }
}

/** Metadata and pages share the range failure, including reads requested after opening. */
async function describePdf(doc, close, guarded) {
  /** @type {Map<number, Promise<any>>} */
  const loaded = new Map();
  const page = (/** @type {number} */ i) => {
    let found = loaded.get(i);
    if (!found) {
      found = guarded(doc.getPage(i + 1));
      loaded.set(i, /** @type {Promise<any>} */ (found));
    }
    return /** @type {Promise<any>} */ (guarded(found));
  };
  const sizeOf = (/** @type {any} */ p) => {
    const viewport = p.getViewport({ scale: CSS_PER_POINT });
    return { width: round(viewport.width), height: round(viewport.height) };
  };
  const first = sizeOf(await page(0));
  /** @type {Size[]} */
  const pages = Array.from({ length: doc.numPages }, () => ({ ...first }));

  /** The page a destination goes to: a name, or an explicit [page ref, /XYZ, ...] array. */
  const resolve = async (/** @type {unknown} */ dest) => {
    try {
      const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return undefined;
      const [ref] = explicit;
      if (Number.isInteger(ref)) return /** @type {number} */ (ref);
      if (ref && typeof ref === "object")
        return /** @type {number} */ (await doc.getPageIndex(ref));
    } catch {}
    return undefined;
  };

  /** @returns {Promise<Toc[]>} */
  const outline = async (/** @type {any[]} */ items) => {
    /** @type {Toc[]} */
    const out = [];
    for (const item of items) {
      const children = await outline(item.items ?? []);
      const unit = item.dest ? await resolve(item.dest) : undefined;
      const title = String(item.title ?? "").trim() || "Untitled";
      if (unit !== undefined) out.push({ title, unit, children });
      else out.push(...children);
    }
    return out;
  };
  const toc = await guarded(outline((await guarded(doc.getOutline().catch(() => null))) ?? []));

  const meta = await guarded(doc.getMetadata().catch(() => ({})));
  const title = String(meta?.info?.Title ?? meta?.metadata?.get?.("dc:title") ?? "").trim();

  /** @type {Map<number, Promise<string>>} */
  const texts = new Map();
  const text = (/** @type {number} */ i) => {
    let found = texts.get(i);
    if (!found) {
      found = page(i)
        .then((p) => textContent(p))
        .then((items) => items.map((t) => (t.str ?? "") + (t.hasEOL ? "\n" : "")).join(""))
        .catch(() => "");
      texts.set(i, found);
    }
    return found;
  };

  /** @returns {Promise<Link[]>} */
  const links = async (/** @type {number} */ i) => {
    const annotations = await (await page(i)).getAnnotations().catch(() => []);
    /** @type {Link[]} */
    const out = [];
    for (const a of annotations) {
      if (a.subtype !== "Link") continue;
      if (a.url) out.push({ rect: a.rect, url: a.url });
      else if (a.dest) {
        const unit = await resolve(a.dest);
        if (unit !== undefined) out.push({ rect: a.rect, unit });
      }
    }
    return out;
  };

  return {
    kind: /** @type {const} */ ("pages"),
    format: "PDF",
    title,
    pages,
    toc,
    text,
    links,
    page,
    resolve,
    doc,
    measure: async (/** @type {number} */ i) => {
      const size = sizeOf(await page(i));
      pages[i] = size;
      return size;
    },
    close,
  };
}
