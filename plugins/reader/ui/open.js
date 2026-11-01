// Opens a file's bytes as a book: the format from detect.js, then its reader. Whatever cannot be
// shown comes back as a details view (name, size, format, one sentence why), and a locked PDF as a
// password request: never an error the surface would have to catch.
import { detect, formatOfName } from "./detect.js";
import { PasswordNeeded, Unreadable } from "./formats/errors.js";
import { paintImage, paintSvg } from "./paint.js";
import { paintPdf } from "./pdf-paint.js";

/**
 * @typedef {import("./formats/errors.js").Fact} Fact
 * @typedef {import("./formats/imagesize.js").Size} Size
 * @typedef {import("./formats/toc.js").Toc} Toc
 * @typedef {{ unit: number, anchor?: string }} Target
 * @typedef {{ go(unit: number): void, external(url: string): void, signal?: AbortSignal,
 *   progress?(done: number, total: number): void }} PaintHooks
 * @typedef {(i: number, host: HTMLElement, scale: number, hooks: PaintHooks) => Promise<void>} Paint
 * @typedef {{ kind: "pages", format: string, title: string, pages: Size[], toc: Toc[],
 *   text(i: number): Promise<string>, measure?(i: number, signal?: AbortSignal): Promise<Size>, paint: Paint,
 *   close?(): unknown, beginDecode?(signal?: AbortSignal): () => void, stopped?(): boolean,
 *   scaled?: boolean, note?: string }} PagesBook
 * @typedef {{ html: string, css: string[], fonts?: Array<{ family: string, bytes: Uint8Array }> }} Chapter
 * @typedef {{ kind: "chapters", format: string, title: string, chapters: Array<{ title: string }>,
 *   toc: Toc[], chapter(i: number, signal?: AbortSignal): Promise<Chapter>, target(href: string, from: number): Target | undefined,
 *   text(i: number): Promise<string>, close?(): unknown }} ChaptersBook
 * @typedef {{ kind: "details", name: string, size: number, format: string, why: string, facts: Fact[] }} DetailsBook
 * @typedef {{ kind: "password", name: string, size: number, format: string, wrong: boolean }} PasswordBook
 * @typedef {PagesBook | ChaptersBook | DetailsBook | PasswordBook} Book
 * @typedef {{ name: string, path: string, password?: string, pdfjs?: () => Promise<object>,
 *   signal?: AbortSignal, readAll?: () => Promise<Uint8Array>, phase?: (label: string) => void,
 *   startWorker?: import("./djvu-client.js").StartWorker }} OpenOptions
 * @typedef {Uint8Array | import("@endue-ai/plugin-sdk").ByteSource} Input
 */

const LABELS = /** @type {Record<string, string>} */ ({
  pdf: "PDF",
  xps: "XPS",
  epub: "EPUB",
  mobi: "MOBI",
  fb2: "FB2",
  cbz: "CBZ comic",
  cbt: "CBT comic",
  cbr: "CBR comic",
  cb7: "CB7 comic",
  djvu: "DjVu",
  unknown: "Unknown",
});

/** Formats read by ranges: the rest are read whole. */
const RANGED = ["pdf", "epub", "xps", "cbz", "cbr", "cb7", "djvu"];

/** Bytes as the Source the readers take; a ByteSource already is one. @param {Input} input */
const sourceOf = (input) =>
  input instanceof Uint8Array
    ? {
        size: input.length,
        read: async (/** @type {number} */ offset, /** @type {number} */ length) =>
          input.subarray(offset, Math.min(input.length, offset + length)),
      }
    : input;

/** A comic's pages are its images, drawn whole into the box the view sized. */
const comic = (/** @type {import("./formats/comics.js").ComicBook} */ book) => ({
  ...book,
  /** @type {Paint} */
  paint: async (i, host, _scale, hooks) => {
    const image = await book.image(i, hooks.signal, hooks.progress);
    hooks.signal?.throwIfAborted();
    paintImage(host, image, `Page ${i + 1}`);
  },
});

/**
 * @param {Input} input
 * @param {import("./detect.js").Detected} found
 * @param {OpenOptions} options
 * @returns {Promise<Book>}
 */
async function read(input, found, options) {
  const bytes = RANGED.includes(found.format)
    ? input
    : input instanceof Uint8Array
      ? input
      : await options.readAll();
  options.signal?.throwIfAborted();
  options.phase?.("Parsing");
  switch (found.format) {
    case "pdf": {
      if (!options.pdfjs) throw new Unreadable("This build of the reader has no PDF engine.");
      const { openPdf } = await import("./formats/pdf.js");
      const lib = await options.pdfjs();
      const book = await openPdf(input, {
        pdfjs: lib,
        password: options.password,
        signal: options.signal,
      });
      return {
        ...book,
        paint: (i, host, scale, hooks) => paintPdf(lib, book, i, host, scale, hooks),
      };
    }
    case "epub": {
      const { readEpub } = await import("./formats/epub.js");
      if (!found.zip) throw new Unreadable("The EPUB is damaged.");
      return readEpub(found.zip);
    }
    case "mobi": {
      const { readMobi } = await import("./formats/mobi.js");
      return readMobi(bytes);
    }
    case "fb2": {
      const { readFb2 } = await import("./formats/fb2.js");
      return readFb2(bytes);
    }
    case "xps": {
      const { readXps } = await import("./formats/xps.js");
      if (!found.zip) throw new Unreadable("The XPS document is damaged.");
      const book = await readXps(found.zip);
      return {
        ...book,
        paint: async (i, host, _scale, hooks) =>
          paintSvg(host, await book.page(i, hooks.signal), {
            signal: hooks.signal,
            go: hooks.go,
            external: hooks.external,
            target: (href) => book.target(href, i),
          }),
      };
    }
    case "cbz":
    case "cbt": {
      const { readComic } = await import("./formats/comics.js");
      const { readTar } = await import("./formats/tar.js");
      const archive = found.format === "cbz" ? found.zip : readTar(bytes);
      if (!archive) throw new Unreadable("The archive is damaged.");
      return comic(await readComic(archive, found.format === "cbz" ? "CBZ" : "CBT"));
    }
    case "cbr":
    case "cb7": {
      const { readArchiveComic } = await import("./formats/archive-comic.js");
      const kind = found.format === "cbr" ? "CBR" : "CB7";
      const { signal, name } = options;
      return comic(await readArchiveComic(sourceOf(input), kind, { name, signal }));
    }
    case "djvu": {
      const { readDjvu } = await import("./formats/djvu.js");
      const { paintDjvu } = await import("./djvu-paint.js");
      const { signal, startWorker } = options;
      const book = await readDjvu(sourceOf(input), { signal, startWorker });
      return { ...book, paint: (i, host, zoom, hooks) => paintDjvu(book, i, host, zoom, hooks) };
    }
    default:
      throw new Unreadable("The reader does not know this kind of file.");
  }
}

/** @param {Input} input @param {OpenOptions} options @returns {Promise<Book>} */
export async function openBook(input, options) {
  const { name } = options;
  const size = input instanceof Uint8Array ? input.length : input.size;
  let format = formatOfName(name);
  try {
    options.signal?.throwIfAborted();
    const bytes = input instanceof Uint8Array ? input : await input.read(0, Math.min(size, 4096));
    const found = await detect(bytes, name, input instanceof Uint8Array ? undefined : input);
    format = found.format;
    return await read(input, found, options);
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError") throw error;
    if (error instanceof PasswordNeeded)
      return { kind: "password", name, size, format: "PDF", wrong: error.wrong };
    const label = LABELS[format] ?? "Unknown";
    if (error instanceof Unreadable)
      return {
        kind: "details",
        name,
        size,
        format: error.format ?? label,
        why: error.why,
        facts: error.facts,
      };
    const problem = error instanceof Error ? error.message : String(error);
    return {
      kind: "details",
      name,
      size,
      format: label,
      why: "The file is damaged or not what its name says: the reader cannot open it.",
      facts: problem ? [{ label: "Problem", value: problem.slice(0, 200) }] : [],
    };
  }
}
