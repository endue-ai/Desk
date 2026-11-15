// The terminal's right-click menu (Copy, Paste, Select all, Clear, Find, the splits), from the base kit's
// .desk-menu: arrows and Home/End move, Enter or a click runs an item, Escape, a click elsewhere or
// leaving it closes the menu and gives the focus back.

/** @typedef {{ label: string, keys?: string, disabled?: boolean, run(): unknown }} MenuItem */

/** @param {Document} doc */
export function createMenu(doc) {
  /** @type {HTMLElement | null} */
  let open = null;
  /** @type {(() => void) | null} */
  let restore = null;

  const close = (/** @type {boolean} */ refocus = true) => {
    if (!open) return;
    open.remove();
    open = null;
    doc.removeEventListener("pointerdown", outside, true);
    const back = restore;
    restore = null;
    if (refocus) back?.();
  };
  const outside = (/** @type {Event} */ event) => {
    if (open && !open.contains(/** @type {Node} */ (event.target))) close(false);
  };

  return {
    /**
     * Show `items` at the pointer, inside the page.
     * @param {number} x
     * @param {number} y
     * @param {MenuItem[]} items
     * @param {() => void} back gives the focus back when the menu closes
     */
    show(x, y, items, back) {
      close(false);
      const menu = doc.createElement("div");
      menu.className = "desk-menu terminal-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Terminal");
      /** @type {HTMLButtonElement[]} */
      const buttons = items.map((item) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "desk-row menu-item";
        button.setAttribute("role", "menuitem");
        button.disabled = item.disabled === true;
        const label = doc.createElement("span");
        label.textContent = item.label;
        button.append(label);
        if (item.keys) {
          const keys = doc.createElement("kbd");
          keys.textContent = item.keys;
          button.append(keys);
        }
        button.addEventListener("click", () => {
          close(true);
          void item.run();
        });
        return button;
      });
      menu.append(...buttons);
      menu.addEventListener("keydown", (event) => {
        const enabled = buttons.filter((b) => !b.disabled);
        const at = enabled.indexOf(/** @type {HTMLButtonElement} */ (doc.activeElement));
        const to = /** @type {Record<string, number>} */ ({
          ArrowDown: at + 1,
          ArrowUp: at - 1,
          Home: 0,
          End: enabled.length - 1,
        })[event.key];
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          close(true);
        } else if (to !== undefined && enabled.length > 0) {
          event.preventDefault();
          enabled[(to + enabled.length) % enabled.length]?.focus();
        }
        event.stopPropagation();
      });
      doc.body.append(menu);
      const view = doc.defaultView;
      const width = view?.innerWidth ?? 0;
      const height = view?.innerHeight ?? 0;
      const box = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(x, width - box.width))}px`;
      menu.style.top = `${Math.max(0, Math.min(y, height - box.height))}px`;
      open = menu;
      restore = back;
      doc.addEventListener("pointerdown", outside, true);
      buttons.find((b) => !b.disabled)?.focus();
    },
    close,
    isOpen: () => open !== null,
  };
}

/**
 * The items of a pane's menu, and of its tab's: the clipboard, the scrollback, the tab's name and the
 * pane's splits (issue 315).
 * @param {{
 *   term: { hasSelection(): boolean, focus(): void, selectAll(): void, clear(): void },
 *   chord(key: string): string, copy(): unknown, paste(): unknown, find(): unknown,
 *   rename(): unknown, split(direction: "right" | "down"): unknown, close(): unknown,
 * }} the
 * @returns {MenuItem[]}
 */
export function paneItems({ term, chord, copy, paste, find, rename, split, close }) {
  return [
    {
      label: "Copy",
      keys: chord("C"),
      disabled: !term.hasSelection(),
      run: () => {
        term.focus();
        copy();
      },
    },
    {
      label: "Paste",
      keys: chord("V"),
      run: () => {
        term.focus();
        paste();
      },
    },
    { label: "Select all", run: () => term.selectAll() },
    { label: "Clear", run: () => term.clear() },
    { label: "Find", keys: chord("F"), run: find },
    { label: "Rename tab", run: rename },
    { label: "Split right", run: () => split("right") },
    { label: "Split down", run: () => split("down") },
    { label: "Close pane", run: close },
  ];
}
