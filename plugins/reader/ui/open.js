// Opens a file's bytes as a book: the format from detect.js, then its reader. Whatever cannot be
// shown comes back as a details view (name, size, format, one sentence why), and a locked PDF as a
// password request: never an error the surface would have to catch.
import { detect, formatOfName } from "./detect.js";
import { describe, NOT_YET } from "./formats/describe.js";
import { PasswordNeeded, Unreadable } from "./formats/errors.js";
import { paintImage, paintSvg } from "./paint.js";
import { paintPdf } from "./pdf-paint.js";

/**
 * @typedef {import("./formats/errors.js").Fact} Fact
 * @typedef {import("./formats/imagesize.js").Size} Size
 * @typedef {import("./formats/toc.js").Toc} Toc
 * @typedef {{ unit: number, anchor?: string }} Target
 * @typedef {{ go(unit: number): void, external(url: string): void }} PaintHooks
 * @typedef {(i: number, host: HTMLElement, scale: number, hooks: PaintHooks) => Promise<void>} Paint
 * @typedef {{ kind: "pages", format: string, title: string, pages: Size[], toc: Toc[],
 *   text(i: number): Promise<string>, measure?(i: number): Promise<Size>, paint: Paint,
 *   close?(): unknown }} PagesBook
 * @typedef {{ html: string, css: string[], fonts?: Array<{ family: string, bytes: Uint8Array }> }} Chapter
 * @typedef {{ kind: "chapters", format: string, title: string, chapters: Array<{ title: string }>,
 *   toc: Toc[], chapter(i: number): Promise<Chapter>, target(href: string, from: number): Target | undefined,
 *   text(i: number): Promise<string>, close?(): unknown }} ChaptersBook
 * @typedef {{ kind: "details", name: string, size: number, format: string, why: string, facts: Fact[] }} DetailsBook
 * @typedef {{ kind: "password", name: string, size: number, format: string, wrong: boolean }} PasswordBook
 * @typedef {PagesBook | ChaptersBook | DetailsBook | PasswordBook} Book
 * @typedef {{ name: string, path: string, password?: string, pdfjs?: () => Promise<object> }} OpenOptions
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

/**
 * @param {Uint8Array} bytes
 * @param {import("./detect.js").Detected} found
 * @param {OpenOptions} options
 * @returns {Promise<Book>}
 */
async function read(bytes, found, options) {
  switch (found.format) {
    case "pdf": {
      if (!options.pdfjs) throw new Unreadable("This build of the reader has no PDF engine.");
      const { openPdf } = await import("./formats/pdf.js");
      const lib = await options.pdfjs();
      const book = await openPdf(bytes, { pdfjs: lib, password: options.password });
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
      return { ...book, paint: async (i, host) => paintSvg(host, await book.page(i)) };
    }
    case "cbz":
    case "cbt": {
      const { readComic } = await import("./formats/comics.js");
      const { readTar } = await import("./formats/tar.js");
      const archive = found.format === "cbz" ? found.zip : readTar(bytes);
      if (!archive) throw new Unreadable("The archive is damaged.");
      const book = await readComic(archive, found.format === "cbz" ? "CBZ" : "CBT");
      return {
        ...book,
        paint: async (i, host) => paintImage(host, await book.image(i), `Page ${i + 1}`),
      };
    }
    default: {
      const described = describe(bytes);
      if (described) throw new Unreadable(NOT_YET, described);
      throw new Unreadable("The reader does not know this kind of file.");
    }
  }
}

/** @param {Uint8Array} bytes @param {OpenOptions} options @returns {Promise<Book>} */
export async function openBook(bytes, options) {
  const { name } = options;
  const size = bytes.length;
  let format = formatOfName(name);
  try {
    const found = await detect(bytes, name);
    format = found.format;
    return await read(bytes, found, options);
  } catch (error) {
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
