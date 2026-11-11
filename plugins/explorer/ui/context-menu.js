// A compact keyboard menu kept inside the plugin viewport, returning focus to its selection. The last
// four change files (edits.js), the one that cannot be undone last; Rename and Move to Trash have
// keys on the tree too. Its rows are compact (style.css), so all nine fit the window's first size
// (402×305, a 263 px page); it opens beside the press where it fits, else on the other side, else as
// close as the page allows, and scrolls only in a window too small for nine rows.
const RENAME = "endue.explorer.rename";
const TRASH = "endue.explorer.trash";
/** The gap the menu keeps from the page's edges. */
const MARGIN = 6;
/** @type {Array<[string, string, string?]>} title, command, aria-keyshortcuts */
const ITEMS = [
  ["Open", "endue.explorer.open-selected"],
  ["Open terminal here", "endue.explorer.terminal-here"],
  ["Git status here", "endue.explorer.git-here"],
  ["Show in system file manager", "endue.explorer.show-in-file-manager"],
  ["Copy path", "endue.explorer.copy-path"],
  ["New file", "endue.explorer.new-file"],
  ["New folder", "endue.explorer.new-folder"],
  ["Rename", RENAME, "F2"],
  ["Move to Trash", TRASH, "Delete Meta+Backspace"],
];

/**
 * The command a key on the tree runs: F2 renames; Delete, or Cmd+Backspace as in Finder, moves to the
 * Trash. Every other chord is the desk's (Shift+Delete too: there is no permanent delete).
 * @param {Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">} event
 */
export function keyCommand(event) {
  if (event.ctrlKey || event.altKey || event.shiftKey) return undefined;
  if (event.metaKey) return event.key === "Backspace" ? TRASH : undefined;
  return event.key === "F2" ? RENAME : event.key === "Delete" ? TRASH : undefined;
}

/**
 * Where a menu of `size` opens on a page of `page` for a press at `at`: right of and below the point
 * where it fits there, else left of it and above `at.top` (a row's top edge when the keyboard opened
 * it; the point itself for a pointer), else pushed inside the page.
 * @param {{ x: number, y: number, top?: number }} at
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} page
 */
export function placeMenu(at, size, page) {
  const along = (
    /** @type {number} */ start,
    /** @type {number} */ end,
    /** @type {number} */ length,
    /** @type {number} */ room,
  ) =>
    start + length <= room - MARGIN
      ? start
      : end - length >= MARGIN
        ? end - length
        : Math.max(MARGIN, room - MARGIN - length);
  return {
    left: along(at.x, at.x, size.width, page.width),
    top: along(at.y, at.top ?? at.y, size.height, page.height),
  };
}

/** @param {Document} doc @param {(id: string) => unknown} run @param {() => void} restore */
export function contextMenu(doc, run, restore) {
  const menu = doc.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Selection actions");
  menu.hidden = true;
  const close = (focus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    if (focus) restore();
  };
  const buttons = ITEMS.map(([title, command, keys]) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "desk-row";
    button.setAttribute("role", "menuitem");
    if (keys) button.setAttribute("aria-keyshortcuts", keys);
    button.tabIndex = -1;
    button.textContent = title;
    button.addEventListener("click", () => {
      close(true);
      void run(command);
    });
    menu.append(button);
    return button;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const index = buttons.indexOf(/** @type {HTMLButtonElement} */ (doc.activeElement));
    const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move) buttons[(index + move + buttons.length) % buttons.length]?.focus();
    else if (event.key === "Home") buttons[0]?.focus();
    else if (event.key === "End") buttons.at(-1)?.focus();
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") {
      close(true);
      return;
    } else if (event.key === "Enter" || event.key === " ") buttons[index]?.click();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  doc.addEventListener("pointerdown", (event) => {
    if (!menu.contains(/** @type {Node} */ (event.target))) close();
  });
  doc.defaultView?.addEventListener("blur", () => close());
  doc.defaultView?.addEventListener("resize", () => close(true));
  doc.body.append(menu);
  return {
    close,
    /**
     * Open for a press at `x, y`; `top` is where a menu that opens upward ends (a row's top edge).
     * @param {number} x @param {number} y @param {number} [top]
     */
    show(x, y, top = y) {
      menu.hidden = false;
      menu.style.left = "0px";
      menu.style.top = "0px";
      const { width, height } = menu.getBoundingClientRect();
      const page = {
        width: doc.defaultView?.innerWidth ?? doc.documentElement.clientWidth,
        height: doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight,
      };
      const at = placeMenu({ x, y, top }, { width, height }, page);
      menu.style.left = `${at.left}px`;
      menu.style.top = `${at.top}px`;
      buttons[0]?.focus();
    },
  };
}
