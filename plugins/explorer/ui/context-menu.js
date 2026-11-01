// A compact keyboard menu kept inside the plugin viewport, returning focus to its selection.
const ITEMS = [
  ["Open", "endue.explorer.open-selected"],
  ["Open terminal here", "endue.explorer.terminal-here"],
  ["Git status here", "endue.explorer.git-here"],
  ["Show in system file manager", "endue.explorer.show-in-file-manager"],
];

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
  const buttons = ITEMS.map(([title, command]) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
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
    show(/** @type {number} */ x, /** @type {number} */ y) {
      menu.hidden = false;
      menu.style.left = "0px";
      menu.style.top = "0px";
      const bounds = menu.getBoundingClientRect();
      const width = doc.defaultView?.innerWidth ?? doc.documentElement.clientWidth;
      const height = doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight;
      menu.style.left = `${Math.max(6, Math.min(x, width - bounds.width - 6))}px`;
      menu.style.top = `${Math.max(6, Math.min(y, height - bounds.height - 6))}px`;
      buttons[0]?.focus();
    },
  };
}
