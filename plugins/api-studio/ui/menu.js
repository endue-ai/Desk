// Pop-up menus and small prompts drawn by the studio itself: a list of actions under a button or
// at the pointer (arrows, Enter and Escape work), a one-line question, and a yes/no question.

import { button, h, icon } from "./dom.js";

/**
 * @typedef {{ label: string, icon?: import("./dom.js").IconName, hint?: string, danger?: boolean,
 *   disabled?: boolean, checked?: boolean, run(): void, className?: string } | "-" |
 *   { heading: string }} Item
 */

/** @type {HTMLElement | null} */
let openMenu = null;
/** @type {(() => void) | null} */
let closeOpen = null;

export function closeMenus() {
  closeOpen?.();
}

/**
 * Show a menu at a point or under an element.
 * @param {Item[]} items @param {{ x: number, y: number } | Element} at @param {{ width?: number, className?: string }} [options]
 */
export function showMenu(items, at, options = {}) {
  closeMenus();
  const rows = /** @type {HTMLElement[]} */ ([]);
  const menu = h(`div.as-menu${options.className ? `.${options.className}` : ""}`, {
    role: "menu",
  });
  for (const item of items) {
    if (item === "-") menu.append(h("div.as-menu-sep", { role: "separator" }));
    else if ("heading" in item) menu.append(h("div.as-menu-heading", null, item.heading));
    else {
      const row = h(
        `button.menu-item.as-menu-item${item.danger ? ".is-danger" : ""}${item.className ? `.${item.className}` : ""}`,
        {
          type: "button",
          role: "menuitem",
          disabled: item.disabled,
          onClick: () => {
            closeMenus();
            item.run();
          },
        },
        item.checked !== undefined
          ? h("span.as-menu-check", null, item.checked ? icon("check", 14) : null)
          : null,
        item.icon ? icon(item.icon, 15) : null,
        h("span.as-menu-label", null, item.label),
        item.hint ? h("span.as-menu-hint", null, item.hint) : null,
      );
      rows.push(row);
      menu.append(row);
    }
  }
  if (options.width) menu.style.minWidth = `${options.width}px`;
  document.body.append(menu);
  const rect =
    at instanceof Element
      ? at.getBoundingClientRect()
      : { left: at.x, bottom: at.y, top: at.y, right: at.x };
  const box = menu.getBoundingClientRect();
  const left = Math.max(6, Math.min(innerWidth - box.width - 6, rect.left));
  const below = rect.bottom + 4;
  const top = below + box.height > innerHeight - 6 ? Math.max(6, rect.top - box.height - 4) : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  openMenu = menu;
  let index = -1;
  const focus = (/** @type {number} */ i) => {
    const usable = rows.filter((r) => !(/** @type {HTMLButtonElement} */ (r).disabled));
    if (!usable.length) return;
    index = (i + usable.length) % usable.length;
    usable[index]?.focus();
  };
  const key = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === "Escape") closeMenus();
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focus(index + (event.key === "ArrowDown" ? 1 : -1));
    }
  };
  const away = (/** @type {MouseEvent} */ event) => {
    if (!menu.contains(/** @type {Node} */ (event.target))) closeMenus();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key, true);
  }, 0);
  closeOpen = () => {
    document.removeEventListener("mousedown", away, true);
    document.removeEventListener("keydown", key, true);
    menu.remove();
    if (openMenu === menu) {
      openMenu = null;
      closeOpen = null;
    }
  };
  return menu;
}

/**
 * A small dialog in the middle of the window. Resolves with the dialog's answer, or undefined
 * when it is dismissed.
 * @template T
 * @param {{ title: string, body: Node | Node[], actions: { label: string, kind?: string, value: () => T }[], className?: string, focus?: string }} spec
 * @returns {Promise<T | undefined>}
 */
export function dialog(spec) {
  return new Promise((resolve) => {
    const scrim = h("div.as-scrim");
    const done = (/** @type {T | undefined} */ value) => {
      document.removeEventListener("keydown", key, true);
      scrim.remove();
      resolve(value);
    };
    const key = (/** @type {KeyboardEvent} */ event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      done(undefined);
    };
    const actions = spec.actions.map((a) =>
      button({ label: a.label, kind: a.kind ?? "", onClick: () => done(a.value()) }),
    );
    const box = h(
      `div.as-dialog${spec.className ? `.${spec.className}` : ""}`,
      { role: "dialog", "aria-label": spec.title },
      h(
        "div.as-dialog-head",
        null,
        h("h2", null, spec.title),
        button({ label: "Close", icon: "close", hideLabel: true, onClick: () => done(undefined) }),
      ),
      h("div.as-dialog-body", null, spec.body),
      h("div.as-dialog-foot", null, actions),
    );
    scrim.append(box);
    scrim.addEventListener("mousedown", (e) => {
      if (e.target === scrim) done(undefined);
    });
    document.addEventListener("keydown", key, true);
    document.body.append(scrim);
    const first = /** @type {HTMLElement | null} */ (
      box.querySelector(spec.focus ?? "input, textarea, select") ?? actions.at(-1) ?? null
    );
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        /** @type {HTMLElement | undefined} */ (actions.at(-1))?.click();
      }
    });
  });
}

/** Ask for one line of text. @param {string} title @param {string} label @param {string} [value] @param {string} [action] */
export async function ask(title, label, value = "", action = "Save") {
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.as-dialog-input", { type: "text", value, "aria-label": label })
  );
  const answer = await dialog({
    title,
    body: [h("label.as-dialog-label", null, label), input],
    actions: [
      { label: "Cancel", value: () => undefined },
      { label: action, kind: "desk-btn-primary", value: () => input.value.trim() },
    ],
  });
  return answer || undefined;
}

/** Ask yes or no. @param {string} title @param {string} text @param {string} [action] @param {boolean} [danger] */
export async function confirm(title, text, action = "OK", danger = false) {
  const answer = await dialog({
    title,
    body: h("p.as-dialog-text", null, text),
    actions: [
      { label: "Cancel", value: () => false },
      { label: action, kind: danger ? "desk-btn-danger" : "desk-btn-primary", value: () => true },
    ],
  });
  return answer === true;
}
