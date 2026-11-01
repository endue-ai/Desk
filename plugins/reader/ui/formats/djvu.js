// DjVu books through endue.formats' decoder, in a worker or in the frame (djvu-client.js). Pages are
// laid out at their size and resolution, so 100% is the printed size (96 CSS pixels an inch), and
// drawn at the zoom in use when near the screen (pages.js, djvu-paint.js). The outline (NAVM) is the
// contents; each page's hidden text (TXTz, TXTa) is what search reads.
import { openDjvuDocument } from "../djvu-client.js";
import { Unreadable } from "./errors.js";

/**
 * @typedef {import("./djvu-document.js").Page} Page
 * @typedef {import("./djvu-document.js").Outline} Outline
 * @typedef {import("./djvu-document.js").Raster} Raster
 * @typedef {import("./toc.js").Toc} Toc
 */

const CSS_PER_INCH = 96;
const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** Entries that go to a page; one that links elsewhere gives way to its children. @param {Outline[]} outline @returns {Toc[]} */
const contents = (outline) =>
  outline.flatMap((entry) => {
    const children = contents(entry.children ?? []);
    if (typeof entry.page !== "number") return children;
    return [{ title: entry.title.trim() || "Untitled", unit: entry.page, children }];
  });

/**
 * @param {import("./djvu-document.js").Source} source
 * @param {{ startWorker?: import("../djvu-client.js").StartWorker, signal?: AbortSignal }} [options]
 */
export async function readDjvu(source, options = {}) {
  const format = "DjVu";
  /** @type {import("./djvu-document.js").DjvuDocument} */
  let doc;
  try {
    doc = await openDjvuDocument(source, options);
  } catch (error) {
    if (options.signal?.aborted || /** @type {any} */ (error)?.name === "AbortError") throw error;
    throw new Unreadable(error instanceof Error ? error.message : String(error), { format });
  }
  const shown = doc.pages.find((p) => !p.missing && p.width > 0);
  if (!shown) {
    doc.close();
    throw new Unreadable(doc.note ?? "The document has no page to show.", { format });
  }
  /** A page's pixels, or the first page's for one that is missing. */
  const pixels = doc.pages.map((p) =>
    p.missing || !p.width ? { ...shown, missing: p.missing } : p,
  );
  /** @type {Map<number, Promise<string>>} */
  const texts = new Map();
  const text = (/** @type {number} */ i) => {
    let found = texts.get(i);
    if (!found) {
      found = doc.text(i).then(
        (words) => words ?? "",
        () => "",
      );
      texts.set(i, found);
    }
    return found;
  };
  return {
    kind: /** @type {const} */ ("pages"),
    format,
    title: doc.title ?? "",
    note: doc.note,
    pages: pixels.map((p) => ({
      width: round((p.width * CSS_PER_INCH) / (p.dpi || 300)),
      height: round((p.height * CSS_PER_INCH) / (p.dpi || 300)),
    })),
    pixels,
    toc: contents(doc.outline),
    /** Drawn again at each zoom, like PDF pages. */
    scaled: true,
    text,
    /** Page `i` decoded at `scale` (0 to 1) of its pixels. @returns {Promise<Raster>} */
    raster: (
      /** @type {number} */ i,
      /** @type {number} */ scale,
      /** @type {AbortSignal | undefined} */ signal = undefined,
    ) => doc.render(i, { scale, signal }),
    stopped: () => doc.stopped?.() ?? false,
    close: () => doc.close(),
  };
}
