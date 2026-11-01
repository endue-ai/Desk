// Draws a DjVu page: the page decoded at the scale the zoom needs (sharp on a Retina screen, never
// past what a canvas holds), its hidden text beside the canvas for search and screen readers, and
// the library's note when part of the page is not decoded. The canvas is drawn here alone; in a
// document with no canvas (jsdom) the sized element stands without pixels.

const MAX_PIXELS = 16_000_000;
/** The newest drawing of each page box: an older one finishing late leaves the box alone. */
const newest = new WeakMap();

/**
 * @typedef {import("./formats/djvu-document.js").Raster} Raster
 * @typedef {{ pages: Array<{ width: number }>, pixels: Array<{ width: number, height: number }>,
 *   raster(i: number, scale: number, signal?: AbortSignal): Promise<Raster>, text(i: number): Promise<string> }} DjvuBook
 */

/** @param {HTMLCanvasElement} canvas @param {Raster} raster */
function draw(canvas, raster) {
  const view = /** @type {any} */ (canvas.ownerDocument.defaultView);
  if (!raster.bitmap && !view?.ImageData) return;
  const context = canvas.getContext("2d");
  if (context && raster.bitmap) context.drawImage(raster.bitmap, 0, 0);
  else if (context && raster.rgba) {
    const { rgba, width, height } = raster;
    const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    context.putImageData(new view.ImageData(pixels, width, height), 0, 0);
  }
  raster.bitmap?.close();
}

/**
 * @param {DjvuBook} book @param {number} i @param {HTMLElement} host @param {number} zoom
 * @param {{ signal?: AbortSignal }} hooks
 */
export async function paintDjvu(book, i, host, zoom, hooks) {
  const doc = host.ownerDocument;
  const mine = {};
  newest.set(host, mine);
  const page = book.pixels[i] ?? { width: 1, height: 1 };
  const ratio = Math.min(doc.defaultView?.devicePixelRatio || 1, 2);
  const wanted = ((book.pages[i]?.width ?? 0) * zoom * ratio) / (page.width || 1);
  const most = Math.sqrt(MAX_PIXELS / Math.max(1, page.width * page.height));
  const scale = Math.min(1, wanted, most);
  const [raster, words] = await Promise.all([book.raster(i, scale, hooks.signal), book.text(i)]);
  hooks.signal?.throwIfAborted();
  if (newest.get(host) !== mine) {
    raster.bitmap?.close();
    return;
  }
  const canvas = doc.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  canvas.setAttribute("aria-hidden", "true");
  draw(canvas, raster);
  /** @type {HTMLElement[]} */
  const parts = [canvas];
  if (words) {
    const layer = doc.createElement("div");
    layer.className = "page-text";
    layer.textContent = words;
    parts.push(layer);
  }
  if (raster.note) {
    const note = doc.createElement("p");
    note.className = "page-note";
    note.textContent = raster.note;
    parts.push(note);
  }
  host.replaceChildren(...parts);
}
