// The DOM for the docs plugin: the header (name, format, "Text only"), the toolbar, the outline, the
// pages on the desk's background, the comments panel, find, zoom, the details view and a status
// live region. Pages are drawn a few at a time so a long document never freezes the surface
// (draw.js). In a narrow page the panels fold over the pages (panels.js) and the header is one row
// (style.css). Where the person is in the pages can be read and gone back to (place.js). Chords the
// desk binds (Mod+S, Mod+O, Mod+W, Mod+K) are never prevented. A link goes to `actions.external`;
// the opening's progress is the page's <desk-progress>.
import { renderDetails } from "./details.js";
import { createDraw } from "./draw.js";
import { createFind } from "./find.js";
import { createPanels, headingsOf, renderComments, renderOutline } from "./panels.js";
import { goTo as scrollTo, whereIn } from "./place.js";
import { createProgress } from "./progress.js";

/**
 * @typedef {import("../docs.js").Shown} Shown
 * @typedef {import("../docs.js").Where} Where
 * @typedef {import("../model.js").DocModel} DocModel
 */

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const PX = 96 / 72;

/**
 * @param {Document} doc
 * @param {{ external?(url: string): unknown }} [actions]
 */
export function createView(doc, actions = {}) {
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
  /** Until the person zooms, a page wider than the desk is fitted to it. */
  let zoomed = false;
  /** @type {string | null} */
  let selected = null;
  /** @type {Promise<void>} */
  let drawn = Promise.resolve();
  const draw = createDraw(doc, sheet);
  const panels = createPanels(doc, {
    outline,
    comments: commentsPanel,
    outlineToggle,
    commentsToggle,
  });

  const say = (/** @type {string} */ words) => {
    status.textContent = words;
  };

  const setZoom = (/** @type {number} */ value) => {
    zoom = Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
    sheet.style.zoom = String(zoom);
    zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  };
  const zoomBy = (/** @type {1 | -1} */ step) => {
    zoomed = true;
    const next =
      step > 0
        ? ZOOMS.find((z) => z > zoom + 0.001)
        : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    setZoom(next ?? zoom);
  };
  /** The zoom at which the widest page fills the desk, or undefined before layout. */
  const fitZoom = () => {
    const widest = Math.max(...(model?.sections ?? []).map((s) => s.width), 0);
    if (!widest || desk.clientWidth === 0) return undefined;
    // The sheet's padding is narrower in a narrow page (style.css).
    const pad = Number.parseFloat(doc.defaultView?.getComputedStyle(sheet).paddingLeft ?? "") || 24;
    return (desk.clientWidth - 2 * pad) / (widest * PX);
  };
  const fit = () => {
    zoomed = true;
    const value = fitZoom();
    if (value) setZoom(value);
  };

  const goTo = async (/** @type {string} */ id) => {
    // A panel over the pages folds to show where it went.
    panels.fold();
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
    panels.fold();
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

  const detailEls = () => ({
    facts: byId("details-facts"),
    reason: byId("details-reason"),
    preview: /** @type {HTMLImageElement} */ (byId("details-preview")),
    url: byId("details-url"),
  });

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
  sheet.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const link = target.closest?.("a");
    if (link) {
      event.preventDefault();
      actions.external?.(link.getAttribute("href") ?? "");
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
    else if (mod && key === "0") {
      zoomed = true;
      setZoom(1);
    } else if (key === "escape" && !findBar.hidden) closeFind();
    else if (key === "escape" && selected) select(null);
    else if (!(key === "escape" && panels.fold())) return;
    event.preventDefault();
  });

  return {
    /**
     * @param {Shown | null} shown
     * @param {Where} [where] where to put the view: its place (null: the first page) and the zoom
     *   the person chose (null: the view's). Without it the same document stays where it is and
     *   another starts at its first page.
     */
    async show(shown, where) {
      const mine = ++token;
      const before = model;
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
        const details_ = /** @type {Shown & { doc: import("../model.js").Details }} */ (shown);
        renderDetails(doc, detailEls(), details_);
        say(shown.doc.reason);
        return;
      }
      const docModel = shown.doc;
      sheet.classList.toggle("text-only", docModel.textOnly);
      outlineList(headingsOf(docModel).list);
      comments.render(docModel.comments);
      const count = docModel.comments.length;
      commentsToggle.hidden = count === 0;
      commentsToggle.textContent = `Comments (${count})`;
      panels.show(count > 0);
      // The zoom is set before the pages are drawn: changing it afterwards lays every page out again.
      if (where?.zoom) {
        zoomed = true;
        setZoom(where.zoom);
      } else {
        const fitted = zoomed ? undefined : fitZoom();
        setZoom(fitted && fitted < 1 ? fitted : zoomed ? zoom : 1);
      }
      drawn = draw(docModel, () => mine === token).catch(() => {
        // A model the renderer cannot draw still says so instead of leaving a blank page.
        sheet.replaceChildren();
        layout.hidden = true;
        tools.hidden = true;
        details.hidden = false;
        renderDetails(doc, detailEls(), {
          ...shown,
          doc: {
            kind: "details",
            format: docModel.format,
            formatName: docModel.formatName,
            reason: "Docs could not draw this document.",
          },
        });
      });
      await drawn;
      if (mine !== token || layout.hidden) return;
      if (where || before !== docModel) scrollTo(desk, sheet, where?.at ?? null);
      if (!findBar.hidden && findText.value) runFind();
      const pages = sheet.childElementCount;
      say(
        `${shown.name}: ${pages} ${pages === 1 ? "page" : "pages"}${count ? `, ${count} ${count === 1 ? "comment" : "comments"}` : ""}.`,
      );
    },
    /** Where the view is in the document on screen, and the zoom the person chose. @returns {Where} */
    where: () => ({
      at: model && !layout.hidden ? whereIn(desk, sheet) : null,
      zoom: zoomed ? zoom : null,
    }),
    /** @param {string} words */
    status: say,
    progress: createProgress(doc),
    focus() {
      if (!layout.hidden) desk.focus();
    },
  };
}
