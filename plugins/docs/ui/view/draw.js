// Drawing a document's pages into the sheet: each page at its section's paper size and margins, with
// its header, body, notes and footer, a batch of blocks at a time so a long document never freezes
// the surface. The pages drawn are kept per document, so showing it again is instant.
import { paginate } from "./pages.js";
import { headingsOf } from "./panels.js";
import { renderBlocks } from "./render.js";

/** @typedef {import("../model.js").DocModel} DocModel */

const BATCH = 120;

/** A turn of the event loop: a message, which a hidden page does not throttle as it does timers. */
const pause = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve(undefined);
    };
    channel.port2.postMessage(null);
  });

/**
 * @param {Document} doc
 * @param {HTMLElement} sheet
 * @returns {(model: DocModel, current: () => boolean) => Promise<void>} draws every page of a
 *   model, and stops between batches once `current` answers false
 */
export function createDraw(doc, sheet) {
  /** @type {WeakMap<DocModel, HTMLElement[]>} */
  const cache = new WeakMap();

  const part = (/** @type {string} */ className, /** @type {number} */ min) => {
    const el = doc.createElement("div");
    el.className = className;
    if (min) el.style.minHeight = `${min}pt`;
    return el;
  };
  const renderNote = (
    /** @type {import("../model.js").Note} */ note,
    /** @type {Parameters<typeof renderBlocks>[1]} */ ctx,
  ) => {
    const el = doc.createElement("div");
    el.className = `note ${note.kind}`;
    el.id = `docs-note-${note.id}`;
    const label = doc.createElement("span");
    label.className = "note-label";
    label.textContent = note.label;
    const text = doc.createElement("div");
    text.className = "note-text";
    renderBlocks(note.blocks, ctx, text);
    el.append(label, text);
    return el;
  };

  return async (model, current) => {
    const cached = cache.get(model);
    if (cached) {
      sheet.replaceChildren(...cached);
      return;
    }
    sheet.replaceChildren();
    const pages = paginate(model);
    const { ids } = headingsOf(model);
    const notes = new Map(model.notes.map((n) => [n.id, n]));
    /** @type {HTMLElement[]} */
    const drawnPages = [];
    let budget = BATCH;
    for (const [index, page] of pages.entries()) {
      const { section } = page;
      const m = section.margins;
      const header = m.header ?? m.top / 2;
      const footer = m.footer ?? m.bottom / 2;
      const article = doc.createElement("article");
      article.className = "page";
      article.setAttribute("aria-label", `Page ${index + 1} of ${pages.length}`);
      article.style.width = `${section.width}pt`;
      article.style.minHeight = `${section.height}pt`;
      // Pages off screen skip layout and paint until they come near, so a long document stays light.
      article.style.containIntrinsicSize = `auto ${section.width}pt auto ${section.height}pt`;
      article.style.padding = `${header}pt ${m.right}pt ${footer}pt ${m.left}pt`;
      const ctx = { doc, page: index + 1, pages: pages.length, headings: ids, notes: new Set() };
      const top = part("page-header", Math.max(0, m.top - header));
      renderBlocks(section.header, ctx, top);
      const body = part("page-body", 0);
      // The page is on the sheet before its body is complete, so a long page appears at once
      // and fills in while the surface stays responsive.
      article.append(top, body);
      sheet.append(article);
      drawnPages.push(article);
      for (let at = 0; at < page.blocks.length; at += BATCH) {
        renderBlocks(page.blocks.slice(at, at + BATCH), ctx, body);
        budget -= Math.min(BATCH, page.blocks.length - at);
        if (budget <= 0) {
          budget = BATCH;
          await pause();
          if (!current()) return;
        }
      }
      const own = [...ctx.notes].map((id) => notes.get(id)).filter((n) => n?.kind === "footnote");
      const last = index === pages.length - 1;
      const ends = last ? model.notes.filter((n) => n.kind === "endnote") : [];
      const noteBox = part("page-notes", 0);
      for (const note of [...own, ...ends]) if (note) noteBox.append(renderNote(note, ctx));
      const bottom = part("page-footer", Math.max(0, m.bottom - footer));
      renderBlocks(section.footer, ctx, bottom);
      article.append(...(noteBox.childElementCount ? [noteBox] : []), bottom);
      budget--;
    }
    cache.set(model, drawnPages);
  };
}
