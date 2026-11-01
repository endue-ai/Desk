// A DjVu document as the reader uses it, over endue.formats' openDjvu: its pages' sizes and
// resolutions, the outline, a page's hidden text and a page drawn at a scale. It runs in the DjVu
// library worker (library-worker.js) or, where none starts, in the frame. No SDK, no DOM.

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * @typedef {{ width: number, height: number, dpi: number, rotation: number, missing?: string }} Page
 * @typedef {{ title: string, url: string, page: number | null, children: Outline[] }} Outline
 * @typedef {{ width: number, height: number, rgba?: Uint8Array, bitmap?: ImageBitmap, note?: string }} Raster
 * @typedef {{ title?: string, note?: string, pages: Page[], outline: Outline[],
 *   render(i: number, options: { scale: number, signal?: AbortSignal }): Promise<Raster>,
 *   text(i: number): Promise<string | null>, stopped?(): boolean, close(): void }} DjvuDocument
 */

const tag = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
const u16 = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32 = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  ((u16(b, at) << 16) | u16(b, at + 2)) >>> 0;

/**
 * openDjvu reads a bundled document's whole FORM:DJVM for its directory (DIRM) and outline (NAVM),
 * which come before the first page (DjVu v3, 8.3.2 and 8.3.3). That one read gets the part before
 * the first page, so a book is not read whole to open; every other read passes through.
 * @param {Source} source @returns {Source}
 */
export function headFirst(source) {
  /** @type {Promise<{ offset: number, length: number, first: number } | null> | undefined} */
  let plan;
  const planned = async () => {
    const head = await source.read(0, 32);
    const at = tag(head, 0) === "AT&T" ? 4 : 0;
    if (tag(head, at) !== "FORM" || tag(head, at + 8) !== "DJVM" || tag(head, at + 12) !== "DIRM")
      return null;
    const count = u16(head, at + 21);
    if (((head[at + 20] ?? 0) & 0x80) === 0 || count === 0) return null;
    const offsets = await source.read(at + 23, count * 4);
    let first = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 4 <= offsets.length; i += 4) {
      const offset = u32(offsets, i);
      if (offset > at + 12) first = Math.min(first, offset);
    }
    const length = Math.min(8 + u32(head, at + 4), source.size - at);
    return Number.isFinite(first) ? { offset: at, length, first } : null;
  };
  return {
    size: source.size,
    async read(offset, length) {
      plan ??= planned().catch(() => null);
      const whole = await plan;
      if (
        whole &&
        offset === whole.offset &&
        length === whole.length &&
        whole.first < offset + length
      )
        return source.read(offset, whole.first - offset);
      return source.read(offset, length);
    },
  };
}

/**
 * @param {(source: Source) => Promise<any>} openDjvu endue.formats' opener
 * @param {Source} source
 * @returns {Promise<DjvuDocument>}
 */
export async function openDocument(openDjvu, source) {
  const doc = await openDjvu(headFirst(source));
  /** @type {Outline[]} */
  const outline = await doc.outline().catch(() => []);
  return {
    title: doc.title,
    note: doc.note,
    pages: doc.pages,
    outline,
    render: (i, options) => doc.renderPage(i, options),
    text: (i) => doc.pageText(i),
    close() {},
  };
}
