// Comics (CBZ, CBT, and CBR and CB7 through archive-comic.js): every image in the archive, in natural
// order ("2.jpg" before "10.jpg"), one page each. Pages are laid out at the first image's size until
// each one is measured.
import { isImage, mimeOf, naturalCompare } from "./bytes.js";
import { Unreadable } from "./errors.js";
import { imageSize } from "./imagesize.js";

/**
 * @typedef {import("./imagesize.js").Size} Size
 * @typedef {(done: number, total: number) => void} Report
 * @typedef {{ names: string[], read(name: string, signal?: AbortSignal, report?: Report): Uint8Array | Promise<Uint8Array> }} Archive
 * @typedef {{ kind: "pages", format: string, title: string, names: string[], pages: Size[],
 *   toc: import("./toc.js").Toc[], image(i: number, signal?: AbortSignal, report?: Report): Promise<{ mime: string, bytes: Uint8Array }>,
 *   measure(i: number, signal?: AbortSignal, report?: Report): Promise<Size>, text(i: number): Promise<string> }} ComicBook
 */

/** macOS resource forks and hidden files are not pages. */
export const hidden = (/** @type {string} */ name) =>
  name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

/**
 * @param {Archive} archive
 * @param {"CBZ" | "CBT" | "CBR" | "CB7"} kind
 * @returns {Promise<ComicBook>}
 */
export async function readComic(archive, kind) {
  const format = `${kind} comic`;
  const names = archive.names.filter((n) => isImage(n) && !hidden(n)).sort(naturalCompare);
  if (names.length === 0)
    throw new Unreadable("The archive holds no images to show as pages.", { format });
  /** @type {Map<number, Size>} */
  const measured = new Map();
  const image = async (
    /** @type {number} */ i,
    /** @type {AbortSignal | undefined} */ signal = undefined,
    /** @type {Report | undefined} */ report = undefined,
  ) => {
    signal?.throwIfAborted();
    const name = names[i];
    if (name === undefined) throw new Unreadable(`There is no page ${i + 1}.`, { format });
    return { mime: mimeOf(name), bytes: await archive.read(name, signal, report) };
  };
  const measure = async (
    /** @type {number} */ i,
    /** @type {AbortSignal | undefined} */ signal = undefined,
    /** @type {Report | undefined} */ report = undefined,
  ) => {
    const known = measured.get(i);
    if (known) return known;
    const size = imageSize((await image(i, signal, report)).bytes) ??
      pages[i] ?? { width: 800, height: 1200 };
    measured.set(i, size);
    pages[i] = size;
    return size;
  };
  const first = imageSize((await image(0)).bytes) ?? { width: 800, height: 1200 };
  /** @type {Size[]} */
  const pages = names.map(() => ({ ...first }));
  measured.set(0, first);
  const title = names[0]?.includes("/") ? (names[0].split("/").at(-2) ?? "") : "";
  return {
    kind: "pages",
    format,
    title,
    names,
    pages,
    toc: [],
    image,
    measure,
    text: async () => "",
  };
}
