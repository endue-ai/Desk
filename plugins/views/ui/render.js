// The screen desk.views draws on: the view's title and layout in #root, one action menu and one toast,
// the density by the frame's width, and the keys and pointer that select, act and open the menu.
// Enter runs a component's first action, "." (or the ContextMenu key) and a right click open its
// actions, Escape closes the view.

import { drawComponent, drawContainer, make } from "./draw.js";

/**
 * @typedef {import("./engine.js").Engine} Engine
 * @typedef {import("./engine.js").Screen} Screen
 * @typedef {import("./engine.js").ViewModel} ViewModel
 * @typedef {import("./engine.js").MenuEntry} MenuEntry
 * @typedef {import("./components.js").ComponentModel} ComponentModel
 * @typedef {import("./components.js").NodeModel} NodeModel
 * @typedef {import("./template.js").Env} Env
 * @typedef {HTMLElement & { selectedIndex?: number, activeRow?: { key?: string } | null,
 *   selectedRow?: { key?: string } | null, activeEvent?: { key?: string } | null,
 *   selectedEvent?: { key?: string } | null, rowOf?: (n: EventTarget | null) => { key?: string } | null,
 *   eventOf?: (n: EventTarget | null) => { key?: string } | null }} Lister
 * @typedef {HTMLElement & { show(anchor?: HTMLElement): void, close(): void, open: boolean }} Menu
 */

/** Narrower than this, a frame draws compact. */
const COMPACT = 480;

/**
 * @param {Document} doc
 * @param {() => Engine | undefined} engine  the engine, once it exists
 * @returns {Screen}
 */
export function createScreen(doc, engine) {
  const win = /** @type {Window} */ (doc.defaultView);
  const root = /** @type {HTMLElement} */ (doc.getElementById("root"));
  const menu = /** @type {Menu} */ (doc.getElementById("actions"));
  const toast = /** @type {HTMLElement & { show(text: string): void }} */ (
    doc.getElementById("toast")
  );
  /** Each component's section by path, to draw one again. @type {Map<string, HTMLElement>} */
  const sections = new Map();
  /** @type {ViewModel | null} */
  let model = null;
  /** @type {{ path: string, key: string } | null} */
  let menuFor = null;
  /** @type {MenuEntry[]} */
  let entries = [];

  const density = () => (win.innerWidth < COMPACT ? "compact" : "regular");
  const dense = () => {
    const value = density();
    root.dataset.density = value;
    for (const el of [...root.querySelectorAll("*"), menu, toast])
      if (el.localName.startsWith("desk-")) el.setAttribute("density", value);
  };
  win.addEventListener("resize", dense);

  const buttons = {
    reconnect: (/** @type {string} */ path) => engine()?.reconnect(path),
    requestAccess: (/** @type {string} */ path) => engine()?.requestAccess(path),
    connect: (/** @type {string} */ path) => engine()?.connect(path),
    link: (/** @type {string} */ href) => engine()?.link(href),
  };

  /** The key of the item the arrows are on (or the selected one) in a listing element. */
  const activeKey = (/** @type {Lister} */ el) => {
    if (el.localName === "desk-list") {
      const id = el.getAttribute("aria-activedescendant");
      const option = (id && doc.getElementById(id)) || el.children[el.selectedIndex ?? -1];
      return option?.getAttribute("data-key") ?? undefined;
    }
    const row = el.activeRow ?? el.selectedRow ?? el.activeEvent ?? el.selectedEvent;
    return row?.key;
  };
  const selectedKey = (/** @type {Lister} */ el) => {
    if (el.localName === "desk-list")
      return el.children[el.selectedIndex ?? -1]?.getAttribute("data-key") ?? undefined;
    return (el.selectedRow ?? el.selectedEvent)?.key;
  };
  /** The key of the item a pointer event landed on, if any. */
  const keyAt = (/** @type {Lister} */ el, /** @type {Event} */ event) => {
    const [target] = event.composedPath();
    if (el.rowOf) return el.rowOf(target ?? null)?.key;
    if (el.eventOf) return el.eventOf(target ?? null)?.key;
    for (const node of event.composedPath())
      if (node instanceof HTMLElement && node.parentElement === el) return node.dataset.key;
    return undefined;
  };

  const openMenu = (
    /** @type {Lister} */ el,
    /** @type {string} */ path,
    /** @type {string | undefined} */ key,
  ) => {
    const found = key ? (engine()?.menu(path, key) ?? []) : [];
    if (!key || found.length === 0) return;
    entries = found;
    menuFor = { path, key };
    const item = (/** @type {MenuEntry} */ entry) =>
      make(doc, "div", { role: "menuitem", tabindex: "-1" }, entry.label);
    menu.replaceChildren(...entries.map(item));
    menu.show(el);
  };
  menu.addEventListener("desk-select", (event) => {
    const { index } = /** @type {CustomEvent<{ index: number }>} */ (event).detail;
    const entry = entries[index];
    if (entry && menuFor) void engine()?.choose(menuFor.path, menuFor.key, entry);
  });

  /** Keys, menus and selection on an element that lists items. @param {HTMLElement} el @param {ComponentModel} component */
  const wire = (el, component) => {
    if (!["desk-list", "desk-table", "desk-agenda"].includes(el.localName)) return;
    const lister = /** @type {Lister} */ (el);
    el.addEventListener("keydown", (event) => {
      // The element selected on Enter (and prevented it); a sort header's Enter is the button's.
      if (event.key === "Enter" && event.defaultPrevented) {
        const key = selectedKey(lister);
        if (key) void engine()?.activate(component.path, key);
      } else if (event.key === "." || event.key === "ContextMenu") {
        event.preventDefault();
        openMenu(lister, component.path, activeKey(lister));
      }
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (menu.open) return;
      openMenu(lister, component.path, keyAt(lister, event) ?? activeKey(lister));
    });
  };

  /** @param {NodeModel} node @param {Env} env @returns {HTMLElement} */
  const draw = (node, env) => {
    if (node.kind === "container") return drawContainer(doc, node, (child) => draw(child, env));
    const section = drawComponent(doc, node, env, buttons, wire);
    sections.set(node.path, section);
    return section;
  };

  return {
    draw: (next) => {
      model = next;
      sections.clear();
      menu.close();
      if (!next) {
        root.replaceChildren();
        return;
      }
      const header = make(doc, "header", { class: "bar" });
      header.append(make(doc, "h1", { id: "view-title" }, next.title));
      if (next.description)
        header.append(make(doc, "p", { class: "description" }, next.description));
      root.replaceChildren(header, draw(next.root, next.env));
      dense();
    },
    update: (component, env) => {
      const old = sections.get(component.path);
      if (!old || !model) return;
      const focused = old.contains(doc.activeElement);
      const fresh = drawComponent(doc, component, env, buttons, wire);
      old.replaceWith(fresh);
      sections.set(component.path, fresh);
      dense();
      if (focused)
        /** @type {HTMLElement | null} */ (
          fresh.querySelector("desk-list, desk-table, desk-agenda, desk-button")
        )?.focus();
    },
    notice: (text) => {
      root.replaceChildren(make(doc, "p", { class: "notice", role: "status" }, text));
    },
    toast: (text) => toast.show(text),
  };
}

/**
 * Escape closes the view, unless something in it (the menu) used it first.
 * @param {Document} doc
 * @param {() => Engine | undefined} engine
 */
export function closeOnEscape(doc, engine) {
  doc.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    engine()?.close();
  });
}
