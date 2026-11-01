// The reader's DOM: the title and format, a toolbar (contents, page or chapter with go-to, zoom and
// fit, search, bookmark, note), the side panel, and one of four bodies: continuous pages, a
// chapter, a password field for a locked PDF, or the details of a file it cannot show. Plugin keys
// are only those the desk leaves free; Mod+S, Mod+O, Mod+W and Mod+K are never prevented.

import { createChapters } from "./chapters.js";
import { createFind } from "./find.js";
import { sizeInWords } from "./formats/bytes.js";
import { createPages } from "./pages.js";
import { createProgress } from "./progress.js";
import { createSide } from "./side.js";

/**
 * @typedef {import("./reader.js").ShownModel} ShownModel
 * @typedef {import("./marks.js").At} At
 * @typedef {import("./open.js").Target} Target
 * @typedef {{ moved(at: At): unknown, zoomed(zoom: number): unknown, bookmark(at: At, label: string): unknown,
 *   note(at: At, text: string): unknown, forget(kind: "bookmarks" | "notes", index: number): unknown,
 *   unlock(password: string): unknown, reload?(): unknown, external?(url: string): unknown }} Actions
 */

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** @param {Document} doc @param {Actions} actions */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const [title, detail, tools, status, docPane] = ["title", "detail", "tools", "status", "doc"].map(
    byId,
  );
  const pageInput = /** @type {HTMLInputElement} */ (byId("page"));
  const zoomOut = byId("zoom-out");
  const zoomShown = byId("zoom");
  /** @type {ShownModel | null} */
  let model = null;
  let zoom = 1;

  const book = () => model?.book ?? null;
  const reflowed = () => book()?.kind === "chapters";
  const count = () => {
    const b = book();
    return b?.kind === "pages" ? b.pages.length : b?.kind === "chapters" ? b.chapters.length : 0;
  };
  const say = (/** @type {string} */ text) => {
    status.textContent = text;
  };
  const unitWord = () => (reflowed() ? "Chapter" : "Page");
  const placeName = (/** @type {number} */ unit, /** @type {number} */ offset = 0) => {
    const b = book();
    if (b?.kind !== "chapters") return `Page ${unit + 1}`;
    const name = b.chapters[unit]?.title || `Chapter ${unit + 1}`;
    return offset > 0.02 ? `${name} (${Math.round(offset * 100)}%)` : name;
  };
  const current = () => (reflowed() ? chapters.current() : pages.current());

  /** Show the counter and the buttons for the unit on screen. */
  const counter = (/** @type {number} */ unit) => {
    pageInput.value = String(unit + 1);
    pageInput.max = String(count());
    byId("count").textContent = `/ ${count()}`;
    /** @type {HTMLButtonElement} */ (byId("prev")).disabled = unit <= 0;
    /** @type {HTMLButtonElement} */ (byId("next")).disabled = unit >= count() - 1;
    if (reflowed()) {
      /** @type {HTMLButtonElement} */ (byId("chapter-prev")).disabled = unit <= 0;
      /** @type {HTMLButtonElement} */ (byId("chapter-next")).disabled = unit >= count() - 1;
    }
  };
  const moved = (/** @type {At} */ at) => {
    if (String(at.unit + 1) !== pageInput.value) counter(at.unit);
    actions.moved(at);
  };
  const external = (url) => actions.external?.(url);
  const progress = createProgress(doc.querySelector("desk-progress"), say);
  const work = (detail, operation) => progress.run(detail, operation);

  const pages = createPages(doc, byId("pages"), docPane, {
    moved,
    reload: () => actions.reload?.(),
    go: (unit) => goTo({ unit }),
    external,
    work,
  });
  const chapters = createChapters(byId("chapter"), docPane, {
    moved,
    go: (target) => goTo(target),
    external,
    work,
  });

  /** Go to a page, or a chapter and an anchor or offset in it. */
  async function goTo(/** @type {Target & { offset?: number }} */ target) {
    const b = book();
    if (!b || count() === 0) return null;
    const unit = Math.max(0, Math.min(count() - 1, target.unit));
    counter(unit);
    say(`${unitWord()} ${unit + 1} of ${count()}`);
    if (b.kind === "chapters") {
      const root = await chapters.show(b, unit, target);
      actions.moved(chapters.current());
      return root;
    }
    pages.goTo(unit, target.offset ?? 0);
    return pages.drawn(unit);
  }

  const side = createSide(doc, {
    go: (target) => void goTo(target),
    forget: (kind, index) => actions.forget(kind, index),
    note: (text) => actions.note(side.noteAt(), text),
    placeName,
  });
  const find = createFind(doc, {
    book: () => {
      const b = book();
      return b && (b.kind === "pages" || b.kind === "chapters") ? b : null;
    },
    count,
    current: () => current().unit,
    show: (unit) => goTo({ unit }),
    unitName: (unit) => `${unitWord()} ${unit + 1}`,
    status: () => {},
  });

  const showZoom = () => {
    zoomShown.textContent = `${Math.round(zoom * 100)}%`;
    zoomShown.setAttribute("aria-label", `Zoom ${Math.round(zoom * 100)}%`);
  };
  const setZoom = (/** @type {number} */ next, keep = true) => {
    const z = Math.max(STEPS[0] ?? 0.25, Math.min(STEPS.at(-1) ?? 5, next));
    zoom = reflowed() ? chapters.zoom(z) : pages.zoom(z);
    showZoom();
    /** @type {HTMLButtonElement} */ (zoomOut).disabled = zoom <= (STEPS[0] ?? 0.25);
    if (keep) actions.zoomed(zoom);
  };
  const zoomBy = (/** @type {1 | -1} */ direction) => {
    const next =
      direction > 0
        ? STEPS.find((s) => s > zoom + 0.001)
        : [...STEPS].reverse().find((s) => s < zoom - 0.001);
    if (next !== undefined) setZoom(next);
  };

  /** Show exactly one of the bodies. */
  const body = (/** @type {"empty" | "pages" | "chapter" | "unlock" | "details"} */ which) => {
    for (const id of ["empty", "pages", "chapter", "unlock", "details"])
      byId(id).hidden = id !== which;
    byId("chapter-nav").hidden = which !== "chapter";
  };

  const details = (/** @type {Extract<ShownModel["book"], { kind: "details" }>} */ d) => {
    byId("details-title").textContent = `${d.name} cannot be shown`;
    byId("details-why").textContent = d.why;
    const facts = [
      { label: "Name", value: d.name },
      { label: "Size", value: sizeInWords(d.size) },
      { label: "Format", value: d.format },
      ...d.facts,
    ];
    byId("details-facts").replaceChildren(
      ...facts.flatMap(({ label, value }) => {
        const dt = doc.createElement("dt");
        dt.textContent = label;
        const dd = doc.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
      }),
    );
  };

  // The toolbar.
  byId("prev").addEventListener("click", () => void goTo({ unit: current().unit - 1 }));
  byId("next").addEventListener("click", () => void goTo({ unit: current().unit + 1 }));
  byId("chapter-prev").addEventListener("click", () => void goTo({ unit: current().unit - 1 }));
  byId("chapter-next").addEventListener("click", () => void goTo({ unit: current().unit + 1 }));
  pageInput.addEventListener("change", () => {
    const n = Number.parseInt(pageInput.value, 10);
    if (Number.isInteger(n)) void goTo({ unit: n - 1 });
  });
  zoomOut.addEventListener("click", () => zoomBy(-1));
  byId("zoom-in").addEventListener("click", () => zoomBy(1));
  byId("fit-width").addEventListener("click", () => setZoom(pages.fit("width")));
  byId("fit-page").addEventListener("click", () => setZoom(pages.fit("page")));
  byId("find-toggle").addEventListener("click", () => find.open());
  byId("bookmark").addEventListener("click", () => {
    const at = current();
    void actions.bookmark(at, placeName(at.unit, at.offset));
  });
  byId("add-note").addEventListener("click", () => side.addNote(current()));
  byId("unlock").addEventListener("submit", (event) => {
    event.preventDefault();
    const field = /** @type {HTMLInputElement} */ (byId("password"));
    const password = field.value;
    field.value = "";
    void actions.unlock(password);
  });

  // Plugin keys: only those the desk's keymap leaves free.
  doc.addEventListener("keydown", (event) => {
    // A page whose body was replaced (a reload of the markup) leaves this view behind: it stays quiet.
    if (!model || event.defaultPrevented || !docPane.isConnected) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const typing = /** @type {HTMLElement | null} */ (event.target)?.closest?.(
      "input, textarea, select",
    );
    const open = book()?.kind === "pages" || book()?.kind === "chapters";
    /** @type {(() => unknown) | undefined} */
    let act;
    if (mod && !event.altKey && open) {
      const lower = key.toLowerCase();
      if (lower === "f" && !event.shiftKey) act = () => find.open();
      else if (lower === "g")
        act = () => {
          if (!find.isOpen()) find.open();
          return event.shiftKey ? find.previous() : find.next();
        };
      else if (key === "=" || key === "+") act = () => zoomBy(1);
      else if (key === "-" || key === "_") act = () => zoomBy(-1);
      else if (key === "0") act = () => setZoom(1);
    } else if (key === "Escape" && !mod) {
      if (find.isOpen()) act = () => find.close();
      else if (side.isOpen())
        act = () => {
          side.open(false);
          docPane.focus();
        };
    } else if (!mod && !event.altKey && !typing && open) {
      const unit = current().unit;
      if (key === "ArrowLeft") act = () => goTo({ unit: unit - 1 });
      else if (key === "ArrowRight") act = () => goTo({ unit: unit + 1 });
      else if (key === "Home" && !reflowed()) act = () => goTo({ unit: 0 });
      else if (key === "End" && !reflowed()) act = () => goTo({ unit: count() - 1 });
    }
    if (!act) return;
    event.preventDefault();
    void act();
  });

  return {
    progress: (value) => progress.set(value),
    /** @param {ShownModel | null} next */
    show(next) {
      progress.clear();
      model = next;
      find.reset();
      const b = next?.book;
      title.textContent = next ? next.name : "No document open";
      detail.textContent =
        !next || !b
          ? ""
          : b.kind === "details" || b.kind === "password"
            ? `${b.format} · ${next.path}`
            : `${b.format}${b.title ? ` · ${b.title}` : ""} · ${next.path}`;
      const readable = b?.kind === "pages" || b?.kind === "chapters";
      tools.hidden = !readable;
      if (!readable) side.open(false);
      side.contents(readable && b ? b : null);
      side.marks(readable && next ? next : null);
      if (!next || !b) {
        pages.clear();
        chapters.clear();
        return body("empty");
      }
      if (b.kind === "details") {
        pages.clear();
        chapters.clear();
        details(b);
        return body("details");
      }
      if (b.kind === "password") {
        pages.clear();
        chapters.clear();
        byId("unlock-why").textContent = b.wrong
          ? "That password is not right. Try again."
          : "This PDF is protected by a password.";
        return body("unlock");
      }
      byId("page-label").textContent = unitWord();
      byId("prev").setAttribute("aria-label", `Previous ${unitWord().toLowerCase()}`);
      byId("next").setAttribute("aria-label", `Next ${unitWord().toLowerCase()}`);
      /** @type {HTMLButtonElement} */ for (const id of ["fit-width", "fit-page"])
        byId(id).disabled = b.kind === "chapters";
      const at = { unit: Math.min(next.at.unit, count() - 1), offset: next.at.offset };
      if (b.kind === "pages") {
        chapters.clear();
        body("pages");
        zoom = pages.load(b, { at, zoom: next.zoom });
      } else {
        pages.clear();
        body("chapter");
        zoom = chapters.zoom(next.zoom ?? 1);
        void chapters.show(b, at.unit, { offset: at.offset });
      }
      showZoom();
      counter(at.unit);
    },
    /** @param {ShownModel} next */
    marks(next) {
      model = next;
      side.marks(next);
    },
    status: say,
    focus() {
      const b = book();
      if (b?.kind === "password") byId("password").focus();
      else docPane.focus();
    },
  };
}
