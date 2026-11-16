// The DOM for the explorer: a header with the folder tools, one flat list with role=tree whose rows
// carry their level (the WAI-ARIA tree pattern, roving tabindex) and an icon for what each entry
// is (file-icons.js), and a status live region for what the last action did or why it failed.
// Rows are never the browser's draggables: in WebKit a click that moved a few
// pixels on one became a drag, and the file did not open. They drag their path as desk data through
// ctx.dnd instead, past the SDK's movement threshold, and folders take drops (ADR 0119). Desk chords
// pass through, but for Cmd+Backspace, which trashes as F2 renames, and Mod+A, C, X, V and F, which
// select all, copy, cut, paste and find (#313); Escape first closes a visible preview. Several rows
// can be selected (aria-multiselectable): Shift and Mod clicks pick, and a selected row drags them all.
import { contextMenu, keyCommand } from "./context-menu.js";
import { iconOf } from "./file-icons.js";
import { findView } from "./find-view.js";
import { drawIcon } from "./glyphs.js";
import { previewView } from "./preview-view.js";
import { sizeOf } from "./size.js";
import { parentOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./explorer.js").Header} Header
 * @typedef {{
 *   select(id: string): unknown, activate(id: string): unknown,
 *   pick?(id: string, mods: { shift: boolean, mod: boolean }): unknown,
 *   key(name: string, mods?: { shift: boolean }): unknown, type(letter: string): boolean,
 *   togglePreview(): unknown,
 *   addFolder(): unknown, newFile(): unknown, refresh(): unknown, toggleHidden(): unknown,
 *   context?(command: string): unknown, find?: import("./find-view.js").FindActions,
 * }} Actions
 */

/** Mod chords the tree runs as the explorer's commands. */
const CHORDS = /** @type {Record<string, string>} */ ({
  a: "endue.explorer.select-all",
  c: "endue.explorer.copy",
  x: "endue.explorer.cut",
  v: "endue.explorer.paste",
  f: "endue.explorer.find",
});

/**
 * @param {Document} doc
 * @param {Actions} actions
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginDnd, "draggable">} [dnd]
 */
export function createView(doc, actions, dnd) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const tree = byId("tree");
  const status = byId("status");
  const hidden = /** @type {HTMLButtonElement} */ (byId("toggle-hidden"));
  const empty = byId("empty");
  /** @type {Map<string, HTMLElement>} */
  const items = new Map();
  /** @type {string | null} */
  let selected = null;
  /** @type {ReadonlySet<string>} */
  let marks = new Set();
  const menu = contextMenu(
    doc,
    (id) => actions.context?.(id),
    () => focus(selected),
  );

  tree.addEventListener("contextmenu", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[role=treeitem]");
    if (!(item instanceof HTMLElement) || !item.dataset.id || item.dataset.kind === "more") return;
    event.preventDefault();
    actions.select(item.dataset.id);
    menu.show(event.clientX, event.clientY);
  });

  byId("add-folder").addEventListener("click", () => actions.addFolder());
  byId("new-file").addEventListener("click", () => actions.newFile());
  byId("refresh").addEventListener("click", () => actions.refresh());
  hidden.addEventListener("click", () => actions.toggleHidden());
  const preview = previewView(doc, {
    open: (path) => actions.activate(path),
    close: () => actions.key("Escape"),
  });
  byId("toggle-preview").addEventListener("click", () => actions.togglePreview());
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
    // The second click of a double click must not start a second file read or toggle a folder twice.
    if (event.detail > 1) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.shiftKey || mod) {
      void actions.pick?.(id, { shift: event.shiftKey, mod });
      return;
    }
    actions.select(id);
    void actions.activate(id);
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
    const item = selected === null ? undefined : items.get(selected);
    const entry = item?.dataset.kind === "more" ? undefined : item;
    // F2, Delete and Cmd+Backspace run the menu's Rename and Move to Trash on the selection.
    const edit = keyCommand(event);
    if (edit) {
      if (!entry) return;
      event.preventDefault();
      void actions.context?.(edit);
      return;
    }
    const chord = CHORDS[event.key.toLowerCase()];
    if (chord && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      void actions.context?.(chord);
      return;
    }
    // The desk's chords pass; the tree takes its own keys, and letters for type-ahead.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      if (!entry) return;
      event.preventDefault();
      // Below the row, or above it where there is no room below.
      const bounds = entry.getBoundingClientRect();
      menu.show(bounds.left + 12, bounds.bottom, bounds.top);
      return;
    }
    if (event.key.length === 1 && event.key !== " ") {
      if (actions.type(event.key)) event.preventDefault();
    } else if (TREE_KEYS.includes(event.key)) {
      event.preventDefault();
      if (event.shiftKey) void actions.key(event.key, { shift: true });
      else void actions.key(event.key);
    }
  });
  // Nothing in the tree is the browser's draggable (an icon, a name): a press is a click.
  tree.addEventListener("dragstart", (event) => event.preventDefault());
  const rowOf = (/** @type {unknown} */ target) => {
    const item = target instanceof Element ? target.closest("[role=treeitem]") : null;
    return item instanceof HTMLElement && item.dataset.kind !== "more" ? item : undefined;
  };
  // A row drags its path once the pointer has moved past the SDK's threshold.
  dnd?.draggable(tree, {
    item: (target) => {
      const item = rowOf(target);
      if (!item?.dataset.path) return undefined;
      const kindOf = (/** @type {HTMLElement} */ el) =>
        el.dataset.kind === "dir" ? "folder" : "file";
      // A selected row carries the whole selection; any other row, itself.
      const dragged = marks.has(item.dataset.id ?? "")
        ? [...items.values()].filter((el) => marks.has(el.dataset.id ?? "") && el.dataset.path)
        : [item];
      const paths = dragged.map((el) => ({ path: el.dataset.path ?? "", kind: kindOf(el) }));
      return {
        items: [{ type: "desk/paths", paths }],
        image: { label: item.querySelector(".name")?.textContent ?? "" },
      };
    },
  });
  /** Where a drop lands: a folder's row, or the row of the folder a file is in. */
  const landing = (/** @type {unknown} */ element) => {
    const item = rowOf(element);
    if (item?.dataset.kind === "dir") return item;
    const parent = item?.dataset.path === undefined ? undefined : parentOf(item.dataset.path);
    return (parent !== undefined && items.get(parent)) || null;
  };
  const finder = actions.find && findView(doc, actions.find, () => focus(selected));
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
    item.setAttribute("aria-selected", String(marks.has(model.id) || model.id === selected));
    item.tabIndex = model.id === selected ? 0 : -1;
    if (model.kind === "dir") {
      item.setAttribute("aria-expanded", String(model.expanded === true));
      if (model.loading) item.setAttribute("aria-busy", "true");
    }
    const twisty = doc.createElement("span");
    twisty.className = "twisty";
    twisty.setAttribute("aria-hidden", "true");
    twisty.textContent = model.kind === "dir" ? (model.expanded ? "▾" : "▸") : "";
    const name = doc.createElement("span");
    name.className = "name";
    name.textContent = model.kind === "more" ? `Show ${model.name}` : model.name;
    item.append(twisty, drawIcon(doc, iconOf(model)), name);

    const detail = model.error ?? (model.kind === "symlink" ? "link" : undefined);
    const side = detail ?? (model.size === undefined ? undefined : sizeOf(model.size));
    if (side !== undefined) {
      const span = doc.createElement("span");
      span.className = model.error ? "error" : "detail";
      span.textContent = side;
      item.append(span);
    }
    item.title = model.path;
    return item;
  };

  const selection = (
    /** @type {string | null} */ id,
    /** @type {ReadonlySet<string>} */ picked = new Set(id === null ? [] : [id]),
  ) => {
    selected = id;
    marks = picked;
    for (const [key, item] of items) {
      item.setAttribute("aria-selected", String(marks.has(key) || key === id));
      item.tabIndex = key === id ? 0 : -1;
    }
    tree.tabIndex = id === null || !items.has(id) ? 0 : -1;
  };
  return {
    selection,
    /** @param {Row[]} rows @param {string | null} picked @param {ReadonlySet<string>} [together] */
    tree(rows, picked, together) {
      menu.close(true);
      const heldFocus = tree.contains(doc.activeElement);
      selected = picked;
      marks = together ?? new Set(picked === null ? [] : [picked]);
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

    /** The preview takes the lower part of the page: the selected row stays in sight above it. */
    preview(/** @type {import("./preview.js").Preview | null} */ model) {
      preview.render(model);
      if (model !== null && selected !== null)
        items.get(selected)?.scrollIntoView?.({ block: "nearest" });
    },
    /** The find bar: shown for a model, hidden for null. */
    find: (/** @type {import("./finding.js").FindModel | null} */ model) => finder?.render(model),
    focus,
    dropTarget: tree,
    landing,
  };
}
