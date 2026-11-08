// The DOM half of the Docker surface's drag and drop (dnd.js, ADR 0119). A row of the list drags its
// container or image and an entry of the Files tab its file, past the SDK's movement threshold, so
// a press stays a click and Enter still opens. A drop lands on a container row of the list, on the
// Files tab's folder, or on a folder entry of it; the landing element is what ctx.dnd marks.

import { fileDrag, itemDrag } from "./dnd.js";
import { dropTargetOf } from "./drop.js";
import { specOf } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginDnd} PluginDnd
 * @typedef {import("./drop.js").Target} Target
 */

/**
 * @param {Document} doc
 * @param {PluginDnd | undefined} dnd
 */
export function createDropView(doc, dnd) {
  const split = /** @type {HTMLElement | null} */ (doc.getElementById("split"));
  const list = /** @type {HTMLElement | null} */ (doc.getElementById("view"));
  const asElement = (/** @type {unknown} */ node) => (node instanceof Element ? node : null);
  /** The Files tab's list an element is in. */
  const filesOf = (/** @type {unknown} */ node) =>
    /** @type {HTMLElement | null} */ (asElement(node)?.closest("[data-drop=files]") ?? null);
  /** An entry of the Files tab, not the row that goes up a folder. */
  const entryOf = (/** @type {unknown} */ node) => {
    const spec = filesOf(node) ? specOf(node) : undefined;
    return spec?.item?.kind === "entry" && !spec.el.classList.contains("up") ? spec : undefined;
  };
  /** A container row of the list. */
  const containerOf = (/** @type {unknown} */ node) => {
    const spec = list?.contains(asElement(node)) ? specOf(node) : undefined;
    return spec?.item?.kind === "container" ? spec : undefined;
  };

  if (dnd && split)
    dnd.draggable(split, {
      item: (target) => {
        const entry = entryOf(target);
        const files = filesOf(target);
        if (entry?.item?.kind === "entry" && files) {
          const { container = "", name = "" } = files.dataset;
          return fileDrag({ id: container, name }, entry.item);
        }
        return list?.contains(asElement(target)) ? itemDrag(specOf(target)?.item) : undefined;
      },
    });

  return {
    dropTarget: split ?? {},
    /** Where a drop lands: a folder entry, the Files tab's list, or a container row; else nowhere. */
    landing(/** @type {unknown} */ element) {
      const entry = entryOf(element);
      if (entry?.item?.kind === "entry" && entry.item.dir) return entry.el;
      return filesOf(element) ?? containerOf(element)?.el ?? null;
    },
    /** What a landing element is, for drop.js. @returns {Target | undefined} */
    targetOf(/** @type {unknown} */ element) {
      const files = filesOf(element);
      if (files) {
        const at = dropTargetOf(files);
        if (at.kind !== "files" || !("container" in at)) return undefined;
        const entry = entryOf(element);
        const path = entry?.item?.kind === "entry" && entry.item.dir ? entry.item.path : at.path;
        return { kind: "files", container: at.container, name: at.name ?? "", path };
      }
      const item = containerOf(element)?.item;
      return item?.kind === "container" ? { kind: "container", item } : undefined;
    },
  };
}
