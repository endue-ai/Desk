// Draws the pages the reader's own code makes: a comic's image and an XPS page's SVG with its
// fonts. Both fill the page box the view sized, so zoom is the box's size alone.
import { dataUrl } from "./formats/bytes.js";

/** @typedef {{ family: string, bytes: Uint8Array }} Font */

/** Fonts already added to the document, by family. */
const added = new Set();

/** Load fonts through the FontFace API; where it is missing or refuses one, the desk's fonts stand in. */
export async function loadFonts(
  /** @type {Document} */ doc,
  /** @type {Font[] | undefined} */ fonts,
) {
  const FontFaceClass = /** @type {typeof FontFace | undefined} */ (
    /** @type {any} */ (doc.defaultView)?.FontFace
  );
  const set = /** @type {FontFaceSet | undefined} */ (/** @type {any} */ (doc).fonts);
  if (!FontFaceClass || !set || !fonts) return;
  for (const { family, bytes } of fonts) {
    if (added.has(family)) continue;
    added.add(family);
    try {
      const face = new FontFaceClass(family, /** @type {BufferSource} */ (bytes));
      set.add(await face.load());
    } catch {}
  }
}

/**
 * @param {HTMLElement} host
 * @param {{ mime: string, bytes: Uint8Array }} image
 * @param {string} label
 */
export function paintImage(host, image, label) {
  const img = host.ownerDocument.createElement("img");
  img.alt = label;
  img.decoding = "async";
  img.src = dataUrl(image.mime, image.bytes);
  host.replaceChildren(img);
}

/** @param {HTMLElement} host @param {{ svg: string, fonts: Font[] }} page */
export async function paintSvg(host, page) {
  const doc = host.ownerDocument;
  await loadFonts(doc, page.fonts);
  const parsed = new (doc.defaultView?.DOMParser ?? DOMParser)().parseFromString(
    page.svg,
    "image/svg+xml",
  );
  const svg = doc.importNode(parsed.documentElement, true);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  host.replaceChildren(svg);
}
