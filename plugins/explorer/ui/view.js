// The DOM for the explorer: a header with the folder tools, one flat list with role=tree whose rows
// carry their level (the WAI-ARIA tree pattern, roving tabindex), and a status live region for
// refusals and errors. Rows are draggable: a drop target reads the path as text/plain or
// application/x-desk-path. Desk chords pass through; Escape first closes a visible preview.
import { previewView } from "./preview-view.js";

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./explorer.js").Header} Header
 * @typedef {{
 *   select(id: string): unknown, activate(id: string): unknown,
 *   key(name: string): unknown, type(letter: string): boolean,
 *   addFolder(): unknown, newFile(): unknown, refresh(): unknown, toggleHidden(): unknown,
 * }} Actions
 */

export const PATH_TYPE = "application/x-desk-path";

const sizeOf = (/** @type {number} */ bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const tree = byId("tree");
  const status = byId("status");
  const hidden = /** @type {HTMLButtonElement} */ (byId("toggle-hidden"));
  const empty = byId("empty");
  /** @type {Map<string, HTMLElement>} */
  const items = new Map();
  /** @type {string | null} */
  let selected = null;

  byId("add-folder").addEventListener("click", () => actions.addFolder());
  byId("new-file").addEventListener("click", () => actions.newFile());
  byId("refresh").addEventListener("click", () => actions.refresh());
  hidden.addEventListener("click", () => actions.toggleHidden());
  const preview = previewView(doc, {
    open: (path) => actions.activate(path),
    close: () => actions.key("Escape"),
  });
  byId("toggle-preview").addEventListener("click", () => actions.key(" "));
  doc.body.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      preview.active() &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      void actions.key("Escape");
    }
  });

  tree.addEventListener("click", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[role=treeitem]");
    const id = item instanceof HTMLElement ? item.dataset.id : undefined;
    if (id === undefined) return;
    actions.select(id);
    if (item.dataset.kind === "dir" || item.dataset.kind === "more") void actions.activate(id);
  });
  tree.addEventListener("dblclick", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[role=treeitem]");
    if (
      !(item instanceof HTMLElement) ||
      item.dataset.kind === "dir" ||
      item.dataset.kind === "more"
    )
      return;
    if (item.dataset.id) void actions.activate(item.dataset.id);
  });
  const TREE_KEYS = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    " ",
    "Enter",
  ];
  tree.addEventListener("keydown", (event) => {
    // The desk's chords pass; the tree takes its own keys, and letters for type-ahead.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.length === 1 && event.key !== " ") {
      if (actions.type(event.key)) event.preventDefault();
    } else if (TREE_KEYS.includes(event.key)) {
      event.preventDefault();
      void actions.key(event.key);
    }
  });
  tree.addEventListener("dragstart", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[role=treeitem]");
    const path = item instanceof HTMLElement ? item.dataset.path : undefined;
    if (path === undefined || !event.dataTransfer) return;
    event.dataTransfer.setData(PATH_TYPE, path);
    event.dataTransfer.setData("text/plain", path);
    event.dataTransfer.effectAllowed = "copyLink";
  });
  // The surface becomes visible after show() reaches the desk, which then focuses this frame.
  doc.defaultView?.addEventListener("focus", () => focus(selected));

  const focus = (/** @type {string | null} */ id) => {
    const item = id === null ? undefined : items.get(id);
    if (item) {
      item.focus({ preventScroll: true });
      item.scrollIntoView?.({ block: "nearest" });
    } else tree.focus();
  };

  const row = (/** @type {Row} */ model, /** @type {number} */ index, /** @type {number} */ of) => {
    const item = doc.createElement("li");
    item.setAttribute("role", "treeitem");
    item.id = `row-${index}`;
    item.dataset.id = model.id;
    item.dataset.path = model.path;
    item.dataset.kind = model.kind;
    item.className = `row kind-${model.kind}${model.hidden ? " is-hidden" : ""}`;
    item.style.setProperty("--depth", String(model.depth));
    item.setAttribute("aria-level", String(model.depth + 1));
    item.setAttribute("aria-posinset", String(index + 1));
    item.setAttribute("aria-setsize", String(of));
    item.setAttribute("aria-selected", String(model.id === selected));
    item.tabIndex = model.id === selected ? 0 : -1;
    if (model.kind === "dir") {
      item.setAttribute("aria-expanded", String(model.expanded === true));
      if (model.loading) item.setAttribute("aria-busy", "true");
    }
    item.draggable = model.kind !== "more";

    const twisty = doc.createElement("span");
    twisty.className = "twisty";
    twisty.setAttribute("aria-hidden", "true");
    twisty.textContent = model.kind === "dir" ? (model.expanded ? "▾" : "▸") : "";
    const name = doc.createElement("span");
    name.className = "name";
    name.textContent = model.kind === "more" ? `Show ${model.name}` : model.name;
    item.append(twisty, name);

    const detail = model.error ?? (model.kind === "symlink" ? "link" : undefined);
    const side = detail ?? (model.size === undefined ? undefined : sizeOf(model.size));
    if (side !== undefined) {
      const span = doc.createElement("span");
      span.className = model.error ? "error" : "detail";
      span.textContent = side;
      item.append(span);
    }
    if (model.kind === "dir" && model.depth === 0) item.title = model.path;
    return item;
  };

  const selection = (/** @type {string | null} */ id) => {
    selected = id;
    for (const [key, item] of items) {
      item.setAttribute("aria-selected", String(key === id));
      item.tabIndex = key === id ? 0 : -1;
    }
    tree.tabIndex = id === null || !items.has(id) ? 0 : -1;
  };
  return {
    selection,
    /** @param {Row[]} rows @param {string | null} picked */
    tree(rows, picked) {
      const heldFocus = tree.contains(doc.activeElement);
      selected = picked;
      items.clear();
      const nodes = rows.map((model, index) => {
        const item = row(model, index, rows.length);
        items.set(model.id, item);
        return item;
      });
      tree.replaceChildren(...nodes);
      tree.tabIndex = picked === null || !items.has(picked) ? 0 : -1;
      empty.hidden = rows.length > 0;
      if (heldFocus) focus(selected);
    },

    /** @param {Header} header */
    header(header) {
      hidden.setAttribute("aria-pressed", String(header.showHidden));
      hidden.title = header.showHidden ? "Hide dotfiles" : "Show dotfiles";
      empty.textContent =
        header.folders.length === 0
          ? "No folders yet. Add one to see its files here."
          : "Nothing to show.";
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    preview: preview.render,
    focus,
  };
}
