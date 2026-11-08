// The DOM for the archives plugin: the file's name, format and levels, its details, the tree with
// sort buttons and a name filter, the preview, the extract buttons, the desk's progress element
// (with Cancel) and a status live region. Chords the desk binds are never prevented; Mod+F and
// Escape inside the surface are the plugin's (Escape only while long work runs: it cancels it).
import { createPreview } from "./view-preview.js";
import { createTree } from "./view-tree.js";

/**
 * @typedef {import("./archives.js").ArchiveModel} ArchiveModel
 * @typedef {import("./preview.js").PreviewModel} PreviewModel
 * @typedef {import("./jobs.js").Progress} Progress
 * @typedef {{
 *   select(id: string): unknown, toggle(id: string): unknown, open(id: string): unknown,
 *   up(): unknown, sort(by: "name" | "size" | "date"): unknown, filter(text: string): unknown,
 *   mark(id: string): unknown, extract(which: "selected" | "all"): unknown, stop(): unknown,
 * }} Actions
 */

/** @param {Document} doc @param {Actions} actions */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const name = byId("archive-name");
  const about = byId("archive-about");
  const levels = byId("levels");
  const note = byId("note");
  const details = byId("details");
  const browser = byId("browser");
  const summary = byId("summary");
  const filter = /** @type {HTMLInputElement} */ (byId("filter"));
  const up = /** @type {HTMLButtonElement} */ (byId("up"));
  const selectedButton = /** @type {HTMLButtonElement} */ (byId("extract-selected"));
  const allButton = /** @type {HTMLButtonElement} */ (byId("extract-all"));
  const progress = /** @type {import("@endue-ai/ui").DeskProgress | null} */ (
    /** @type {unknown} */ (doc.querySelector("desk-progress"))
  );
  const status = byId("status");
  const treeElement = byId("tree");
  /** @type {ArchiveModel | null} */
  let model = null;
  /** @type {Progress | null} */
  let working = null;

  const tree = createTree(doc, treeElement, actions);
  const preview = createPreview(doc, byId("preview"), {
    open: () => model?.selected && actions.open(model.selected),
  });

  filter.addEventListener("input", () => actions.filter(filter.value));
  up.addEventListener("click", () => actions.up());
  selectedButton.addEventListener("click", () => actions.extract("selected"));
  allButton.addEventListener("click", () => actions.extract("all"));
  progress?.addEventListener("desk-cancel", () => working?.cancel());
  for (const button of doc.querySelectorAll("button[data-sort]"))
    button.addEventListener("click", () =>
      actions.sort(
        /** @type {"name" | "size" | "date"} */ (/** @type {HTMLElement} */ (button).dataset.sort),
      ),
    );
  levels.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest?.("button[data-up]");
    if (button)
      for (let i = Number(/** @type {HTMLElement} */ (button).dataset.up); i > 0; i--) actions.up();
  });

  doc.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      filter.focus();
      filter.select();
    } else if (event.key === "Escape" && !mod && (working || model?.extracting)) {
      event.preventDefault();
      actions.stop();
    } else if (event.key === "Escape" && !mod && doc.activeElement === filter && filter.value) {
      event.preventDefault();
      filter.value = "";
      actions.filter("");
      treeElement.focus();
    }
  });

  return {
    /** @param {ArchiveModel | null} next */
    archive(next) {
      model = next;
      name.textContent = next ? next.name : "No archive open";
      about.textContent = next ? `${next.format}, ${next.path}` : "";
      levels.hidden = !next || next.levels.length < 2;
      levels.replaceChildren(
        ...(next?.levels ?? []).map((level, i, all) => {
          const item = doc.createElement(i < all.length - 1 ? "button" : "span");
          item.textContent = level;
          if (i < all.length - 1) {
            item.dataset.up = String(all.length - 1 - i);
            /** @type {HTMLButtonElement} */ (item).type = "button";
          } else item.setAttribute("aria-current", "location");
          return item;
        }),
      );
      up.hidden = levels.hidden;
      note.hidden = !next?.note;
      note.textContent = next?.note ?? "";
      details.hidden = !next?.details.length;
      details.replaceChildren(
        ...(next?.details ?? []).flatMap((d) => {
          const dt = doc.createElement("dt");
          dt.textContent = d.label;
          const dd = doc.createElement("dd");
          dd.textContent = d.value;
          return [dt, dd];
        }),
      );
      const listing = !!next && !next.note;
      browser.hidden = !listing;
      filter.hidden = !listing;
      summary.textContent = listing ? (next?.summary ?? "") : "";
      if (next && filter.value !== next.filter) filter.value = next.filter;
      for (const header of doc.querySelectorAll("[aria-sort]")) {
        const by = /** @type {HTMLElement | null} */ (header.querySelector("button[data-sort]"))
          ?.dataset.sort;
        const on = next?.sort.by === by;
        header.setAttribute(
          "aria-sort",
          on ? (next?.sort.descending ? "descending" : "ascending") : "none",
        );
      }
      const refused = next?.refusal;
      selectedButton.disabled = !listing || !!refused || !!next?.extracting;
      allButton.disabled = !listing || !!refused || !!next?.extracting;
      allButton.title = refused ?? "";
      selectedButton.title = refused ?? "";
      tree.render(listing ? (next?.rows ?? []) : [], next?.selected ?? null);
    },

    /** @param {PreviewModel | null} next */
    preview(next) {
      preview(next);
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    /** The work that runs, or null when none does. @param {Progress | null} next */
    progress(next) {
      working = next;
      if (!progress) return;
      progress.hidden = next === null;
      if (!next) return;
      progress.label = next.label;
      progress.value = next.value;
      progress.max = next.max;
      progress.detail = next.detail;
      progress.cancelable = true;
    },

    focus() {
      if (!browser.hidden) treeElement.focus();
    },
  };
}
