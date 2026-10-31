// The DOM for the docs plugin: the header (name, format, "Text only"), the toolbar, the outline, the
// pages on the desk's background, the comments panel, find, zoom, the details view and a status
// live region. Pages are drawn a few at a time so a long document never freezes the surface.
// Chords the desk binds (Mod+S, Mod+O, Mod+W, Mod+K) are never prevented.
import { renderDetails } from "./details.js";
import { createFind } from "./find.js";
import { paginate } from "./pages.js";
import { headingsOf, renderComments, renderOutline } from "./panels.js";
import { renderBlocks } from "./render.js";

/**
 * @typedef {import("../docs.js").Shown} Shown
 * @typedef {import("../model.js").DocModel} DocModel
 */

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const BATCH = 120;
const PX = 96 / 72;

/** @param {Document} doc */
export function createView(doc) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const name = byId("doc-name");
  const format = byId("doc-format");
  const badge = byId("doc-badge");
  const tools = byId("tools");
  const layout = byId("layout");
  const outline = byId("outline");
  const desk = byId("desk");
  const sheet = byId("sheet");
  const commentsPanel = byId("comments");
  const details = byId("details");
  const status = byId("status");
  const findBar = byId("find");
  const findText = /** @type {HTMLInputElement} */ (byId("find-text"));
  const findCount = byId("find-count");
  const outlineToggle = byId("outline-toggle");
  const commentsToggle = byId("comments-toggle");
  const zoomLevel = byId("zoom-level");
  const find = createFind(sheet);
  /** @type {DocModel | null} */
  let model = null;
  let token = 0;
  let zoom = 1;
  /** @type {string | null} */
  let selected = null;
  /** @type {Promise<void>} */
  let drawn = Promise.resolve();
  /** Pages already drawn, per document, so switching back is instant. */
  /** @type {WeakMap<DocModel, HTMLElement[]>} */
  const cache = new WeakMap();

  const say = (/** @type {string} */ words) => {
    status.textContent = words;
  };

  const setZoom = (/** @type {number} */ value) => {
    zoom = Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
    sheet.style.zoom = String(zoom);
    zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  };
  const zoomBy = (/** @type {1 | -1} */ step) => {
    const next =
      step > 0
        ? ZOOMS.find((z) => z > zoom + 0.001)
        : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    setZoom(next ?? zoom);
  };
  const fit = () => {
    const widest = Math.max(...(model?.sections ?? []).map((s) => s.width), 0);
    if (!widest || desk.clientWidth === 0) return;
    setZoom((desk.clientWidth - 40) / (widest * PX));
  };

  const goTo = async (/** @type {string} */ id) => {
    // A heading the batches have not drawn yet is waited for.
    if (!doc.getElementById(id)) await drawn;
    const el = doc.getElementById(id);
    el?.scrollIntoView?.({ block: "start" });
    if (el) say(`Went to ${el.textContent ?? ""}`.slice(0, 200));
  };
  const outlineList = renderOutline(
    doc,
    byId("outline-list"),
    byId("outline-empty"),
    (id) => void goTo(id),
  );

  const select = (/** @type {string | null} */ id) => {
    selected = id;
    for (const el of Array.from(sheet.querySelectorAll(".is-selected")))
      el.classList.remove("is-selected");
    comments.mark(id);
    if (!id) return;
    const marked = Array.from(sheet.querySelectorAll("[data-comments]")).filter((el) =>
      /** @type {HTMLElement} */ (el.dataset.comments ?? "").split(" ").includes(id),
    );
    for (const el of marked) el.classList.add("is-selected");
    marked[0]?.scrollIntoView?.({ block: "center" });
    const comment = model?.comments.find((c) => c.id === id);
    say(
      marked.length
        ? `Comment by ${comment?.author || "unknown author"}`
        : "This comment's range is not in the page.",
    );
  };
  const comments = renderComments(doc, byId("comment-list"), (id) => select(id));

  /** Draw every page of a model into the sheet, a batch of blocks at a time. */
  const draw = async (/** @type {DocModel} */ doc_, /** @type {number} */ mine) => {
    const cached = cache.get(doc_);
    if (cached) {
      sheet.replaceChildren(...cached);
      return;
    }
    sheet.replaceChildren();
    const pages = paginate(doc_);
    const { ids } = headingsOf(doc_);
    const notes = new Map(doc_.notes.map((n) => [n.id, n]));
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
      article.style.padding = `${header}pt ${m.right}pt ${footer}pt ${m.left}pt`;
      const ctx = { doc, page: index + 1, pages: pages.length, headings: ids, notes: new Set() };
      const top = part("page-header", Math.max(0, m.top - header));
      renderBlocks(section.header, ctx, top);
      const body = part("page-body", 0);
      renderBlocks(page.blocks, ctx, body);
      const own = [...ctx.notes].map((id) => notes.get(id)).filter((n) => n?.kind === "footnote");
      const last = index === pages.length - 1;
      const ends = last ? doc_.notes.filter((n) => n.kind === "endnote") : [];
      const noteBox = part("page-notes", 0);
      for (const note of [...own, ...ends]) if (note) noteBox.append(renderNote(note, ctx));
      const bottom = part("page-footer", Math.max(0, m.bottom - footer));
      renderBlocks(section.footer, ctx, bottom);
      article.append(top, body, ...(noteBox.childElementCount ? [noteBox] : []), bottom);
      sheet.append(article);
      drawnPages.push(article);
      budget -= page.blocks.length + 1;
      if (budget <= 0) {
        budget = BATCH;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (mine !== token) return;
      }
    }
    cache.set(doc_, drawnPages);
  };
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

  const closeFind = () => {
    findBar.hidden = true;
    find.clear();
    findCount.textContent = "";
  };
  const openFind = () => {
    findBar.hidden = false;
    findText.focus();
    findText.select?.();
  };
  const runFind = () => {
    const count = find.search(findText.value);
    if (count) find.first();
    showCount();
  };
  const showCount = () => {
    const words = !findText.value
      ? ""
      : find.count
        ? `${find.current + 1} of ${find.count}`
        : "No matches";
    findCount.textContent = words;
    if (words) say(words);
  };
  findText.addEventListener("input", runFind);
  findText.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) find.previous();
    else find.next();
    showCount();
  });
  byId("find-next").addEventListener("click", () => {
    find.next();
    showCount();
  });
  byId("find-prev").addEventListener("click", () => {
    find.previous();
    showCount();
  });
  byId("find-close").addEventListener("click", closeFind);
  byId("find-open").addEventListener("click", openFind);
  byId("zoom-in").addEventListener("click", () => zoomBy(1));
  byId("zoom-out").addEventListener("click", () => zoomBy(-1));
  byId("zoom-fit").addEventListener("click", fit);
  /** Panels the person closed stay closed for the next document. */
  const closed = { outline: false, comments: false };
  const toggle = (
    /** @type {HTMLElement} */ button,
    /** @type {HTMLElement} */ panel,
    /** @type {"outline" | "comments"} */ which,
  ) =>
    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      closed[which] = panel.hidden;
      button.setAttribute("aria-pressed", String(!panel.hidden));
    });
  toggle(outlineToggle, outline, "outline");
  toggle(commentsToggle, commentsPanel, "comments");

  sheet.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const link = target.closest?.("a");
    if (link) {
      event.preventDefault();
      say(`Link: ${link.getAttribute("href") ?? ""}`);
      return;
    }
    const ref = /** @type {HTMLElement | null} */ (target.closest?.(".noteref"));
    if (ref) void goTo(`docs-note-${ref.dataset.note ?? ""}`);
  });
  sheet.addEventListener("auxclick", (event) => {
    if (/** @type {HTMLElement} */ (event.target).closest?.("a")) event.preventDefault();
  });

  doc.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !model || !sheet.isConnected) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && key === "f") openFind();
    else if (mod && !event.altKey && key === "g") {
      if (!findText.value) openFind();
      else {
        if (event.shiftKey) find.previous();
        else find.next();
        showCount();
      }
    } else if (mod && (key === "=" || key === "+")) zoomBy(1);
    else if (mod && (key === "-" || key === "_")) zoomBy(-1);
    else if (mod && key === "0") setZoom(1);
    else if (key === "escape" && !findBar.hidden) closeFind();
    else if (key === "escape" && selected) select(null);
    else return;
    event.preventDefault();
  });

  return {
    /** @param {Shown | null} shown */
    async show(shown) {
      const mine = ++token;
      find.clear();
      selected = null;
      for (const el of Array.from(sheet.querySelectorAll(".is-selected")))
        el.classList.remove("is-selected");
      const document_ = shown?.doc.kind === "document" ? shown.doc : null;
      model = document_;
      name.textContent = shown ? shown.name : "No document open";
      format.textContent = shown ? shown.doc.formatName : "";
      badge.hidden = !document_?.textOnly;
      tools.hidden = !document_;
      layout.hidden = !document_;
      details.hidden = shown?.doc.kind !== "details";
      if (!findBar.hidden && !document_) closeFind();
      if (!shown) {
        sheet.replaceChildren();
        return;
      }
      if (shown.doc.kind === "details") {
        sheet.replaceChildren();
        renderDetails(
          doc,
          {
            facts: byId("details-facts"),
            reason: byId("details-reason"),
            preview: /** @type {HTMLImageElement} */ (byId("details-preview")),
            url: byId("details-url"),
          },
          /** @type {Shown & { doc: import("../model.js").Details }} */ (shown),
        );
        say(shown.doc.reason);
        return;
      }
      const docModel = shown.doc;
      outlineList(headingsOf(docModel).list);
      comments.render(docModel.comments);
      const count = docModel.comments.length;
      commentsToggle.hidden = count === 0;
      commentsToggle.textContent = `Comments (${count})`;
      commentsPanel.hidden = count === 0 || closed.comments;
      commentsToggle.setAttribute("aria-pressed", String(!commentsPanel.hidden));
      outline.hidden = closed.outline;
      drawn = draw(docModel, mine);
      await drawn;
      if (mine !== token) return;
      setZoom(zoom);
      if (!findBar.hidden && findText.value) runFind();
      const pages = sheet.childElementCount;
      say(
        `${shown.name}: ${pages} ${pages === 1 ? "page" : "pages"}${count ? `, ${count} ${count === 1 ? "comment" : "comments"}` : ""}.`,
      );
    },
    /** @param {string} words */
    status: say,
    focus() {
      if (!layout.hidden) desk.focus();
    },
  };
}
