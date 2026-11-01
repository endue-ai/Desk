// PDF through the vendored pdf.js (ui/vendor, ADR 0042), within the plugin frame's CSP: no eval,
// no fetches (no CMaps, standard fonts or wasm: system fonts stand in), and the worker running in
// this thread (the frame's opaque origin cannot start a Worker; main.js imports the worker module
// first, so pdf.js finds globalThis.pdfjsWorker). The bytes go in as data; pdf.js gets a copy.
import { PasswordNeeded, Unreadable } from "./errors.js";

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
const params = (/** @type {Uint8Array} */ bytes, /** @type {string | undefined} */ password) => ({
  data: bytes.slice(),
  ...(password === undefined ? {} : { password }),
  isEvalSupported: false,
  useSystemFonts: true,
  useWorkerFetch: false,
  useWasm: false,
  enableXfa: false,
  disableRange: true,
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
 * @param {Uint8Array} bytes
 * @param {{ pdfjs: Pdfjs | object, password?: string }} options
 */
export async function openPdf(bytes, { pdfjs, password }) {
  const lib = /** @type {Pdfjs} */ (pdfjs);
  const task = lib.getDocument(params(bytes, password));
  /** @type {any} */
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    const { name, code, message } =
      /** @type {{ name?: string, code?: number, message?: string }} */ (error ?? {});
    if (name === "PasswordException") throw new PasswordNeeded(code === 2);
    if (name === "InvalidPDFException")
      throw new Unreadable("The PDF is damaged: its structure cannot be read.", { format: "PDF" });
    throw new Unreadable(`The PDF cannot be opened: ${message ?? name ?? "unknown error"}.`, {
      format: "PDF",
    });
  }
  /** @type {Map<number, Promise<any>>} */
  const loaded = new Map();
  const page = (/** @type {number} */ i) => {
    let found = loaded.get(i);
    if (!found) {
      found = doc.getPage(i + 1);
      loaded.set(i, /** @type {Promise<any>} */ (found));
    }
    return /** @type {Promise<any>} */ (found);
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
  const toc = await outline((await doc.getOutline().catch(() => null)) ?? []);

  const meta = await doc.getMetadata().catch(() => ({}));
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
    close: () => task.destroy(),
  };
}
