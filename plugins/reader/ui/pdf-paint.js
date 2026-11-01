// Draws a PDF page with pdf.js: the canvas (the one place the reader paints pixels), the text layer
// for selection and search, and the annotation layer for the file's links and annotations. Links
// inside the file jump through `go`; links to the web are not followed from the sandboxed frame.
import { CSS_PER_POINT } from "./formats/pdf.js";

const MAX_PIXELS = 16_000_000;

/**
 * @typedef {{ go(unit: number): void, external(url: string): void }} Hooks
 * @typedef {{ page(i: number): Promise<any>, resolve(dest: unknown): Promise<number | undefined>,
 *   pages: unknown[], doc: any }} PdfBook
 */

/** The parts of pdf.js's link service the annotation layer calls. */
function linkService(
  /** @type {PdfBook} */ book,
  /** @type {number} */ at,
  /** @type {Hooks} */ hooks,
) {
  const go = (/** @type {number | undefined} */ unit) => unit !== undefined && hooks.go(unit);
  return {
    pagesCount: book.pages.length,
    page: at + 1,
    rotation: 0,
    isInPresentationMode: false,
    externalLinkEnabled: true,
    eventBus: { dispatch() {}, on() {}, off() {}, _on() {}, _off() {} },
    addLinkAttributes(/** @type {HTMLAnchorElement} */ link, /** @type {string} */ url) {
      link.href = url;
      link.title = url;
      link.rel = "noopener noreferrer nofollow";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        hooks.external(url);
      });
    },
    getDestinationHash: () => "#",
    getAnchorUrl: () => "#",
    setHash() {},
    goToDestination: async (/** @type {unknown} */ dest) => go(await book.resolve(dest)),
    goToPage: (/** @type {number} */ n) => go(n - 1),
    navigateTo: async (/** @type {unknown} */ dest) => go(await book.resolve(dest)),
    executeNamedAction(/** @type {string} */ action) {
      const last = book.pages.length - 1;
      const named = { NextPage: at + 1, PrevPage: at - 1, FirstPage: 0, LastPage: last }[action];
      if (named !== undefined) go(Math.max(0, Math.min(last, named)));
    },
    executeSetOCGState() {},
    cachePageRef() {},
    isPageVisible: () => true,
    isPageCached: () => true,
  };
}

/**
 * @param {any} lib The pdf.js module.
 * @param {PdfBook} book
 * @param {number} i
 * @param {HTMLElement} host
 * @param {number} zoom
 * @param {Hooks} hooks
 */
export async function paintPdf(lib, book, i, host, zoom, hooks) {
  const page = await book.page(i);
  const viewport = page.getViewport({ scale: zoom * CSS_PER_POINT });
  const doc = host.ownerDocument;
  const scale = String(viewport.scale);
  for (const [name, value] of [
    ["--scale-factor", scale],
    ["--total-scale-factor", scale],
    ["--user-unit", "1"],
    ["--scale-round-x", "1px"],
    ["--scale-round-y", "1px"],
  ])
    host.style.setProperty(name, value);
  const canvas = doc.createElement("canvas");
  // Sharp on a Retina screen, but never past what a canvas holds (16 million pixels in WebKit).
  const pixels = viewport.width * viewport.height || 1;
  const ratio = Math.max(
    0.5,
    Math.min(doc.defaultView?.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / pixels)),
  );
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  canvas.setAttribute("aria-hidden", "true");
  const text = doc.createElement("div");
  text.className = "textLayer";
  const notes = doc.createElement("div");
  notes.className = "annotationLayer";
  host.replaceChildren(canvas, text, notes);
  const context = canvas.getContext("2d");
  if (context) {
    const transform = ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0];
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      ...(transform ? { transform } : {}),
    }).promise;
  }
  await new lib.TextLayer({
    textContentSource: page.streamTextContent(),
    container: text,
    viewport,
  }).render();
  const annotations = await page.getAnnotations();
  if (annotations.length === 0) return;
  const service = linkService(book, i, hooks);
  const layer = new lib.AnnotationLayer({
    div: notes,
    page,
    viewport,
    linkService: service,
    annotationStorage: book.doc.annotationStorage,
    accessibilityManager: null,
    annotationCanvasMap: null,
    annotationEditorUIManager: null,
    structTreeLayer: null,
    commentManager: null,
  });
  await layer.render({
    annotations,
    viewport,
    div: notes,
    page,
    linkService: service,
    renderForms: false,
    imageResourcesPath: "",
    enableScripting: false,
    hasJSActions: false,
    fieldObjects: null,
  });
}
