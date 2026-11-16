// A small context menu at the pointer (or under a button), closed by a choice, Escape, or a click
// elsewhere. Arrow keys move through it.
import { h, icon } from "./dom.js";

/**
 * @typedef {{ label: string, icon?: import("./dom.js").IconName, run: () => void, danger?: boolean, disabled?: boolean, hint?: string }} Item
 * @typedef {Item | { separator: true }} Entry
 */

/** @type {(() => void) | null} */
let closeOpen = null;

/** @param {MouseEvent | { clientX: number, clientY: number, target?: EventTarget | null }} at @param {Entry[]} entries */
export function openMenu(at, entries) {
  closeOpen?.();
  const menu = h("div.desk-menu.lm-menu", { role: "menu" });
  for (const entry of entries) {
    if ("separator" in entry) {
      menu.append(h("div.lm-menu-sep", { role: "separator" }));
      continue;
    }
    menu.append(
      h(
        "button.desk-row.lm-menu-item",
        {
          type: "button",
          role: "menuitem",
          disabled: entry.disabled,
          dataset: { danger: entry.danger ? "1" : undefined },
          onClick: () => {
            close();
            entry.run();
          },
        },
        entry.icon ? icon(entry.icon) : h("span.lm-menu-gap"),
        h("span.lm-menu-label", null, entry.label),
        entry.hint ? h("kbd.lm-kbd", null, entry.hint) : null,
      ),
    );
  }
  document.body.append(menu);
  const target = /** @type {HTMLElement | null} */ (
    at.target instanceof HTMLElement ? at.target.closest("button") : null
  );
  const box =
    target && at.clientX === 0 && at.clientY === 0 ? target.getBoundingClientRect() : null;
  const x = box ? box.left : at.clientX;
  const y = box ? box.bottom + 4 : at.clientY;
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  const items = () =>
    /** @type {HTMLButtonElement[]} */ ([...menu.querySelectorAll(".lm-menu-item:not(:disabled)")]);
  items()[0]?.focus();
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = items();
      const at2 = list.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      list[(at2 + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    }
  };
  const onDown = (/** @type {MouseEvent} */ e) => {
    if (!menu.contains(/** @type {Node} */ (e.target))) close();
  };
  function close() {
    menu.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    if (closeOpen === close) closeOpen = null;
  }
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
  closeOpen = close;
  return close;
}
