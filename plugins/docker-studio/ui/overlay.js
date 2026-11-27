// What floats over the page: dialogs (one at a time, focus kept inside, Escape closes), menus at
// the pointer or under a button, confirmations for what cannot be undone, and toasts.

import { button, h, icon } from "./dom.js";

/**
 * @typedef {import("./dom.js").IconName} IconName
 * @typedef {{ label: string, icon?: IconName, danger?: boolean, disabled?: boolean, hint?: string,
 *   run?: () => void } | "-"} MenuItem
 * @typedef {{ title: string, subtitle?: string, body: HTMLElement | HTMLElement[], wide?: boolean,
 *   icon?: IconName, actions?: HTMLElement[], onClose?: () => void, cls?: string }} DialogSpec
 */

export function createOverlay(/** @type {Document} */ doc) {
  const layer = h("div.layer");
  const toasts = h("div.toasts", { role: "status", "aria-live": "polite" });
  doc.body.append(layer, toasts);
  /** @type {(() => void) | null} */
  let closeTop = null;

  const trap = (/** @type {HTMLElement} */ box, /** @type {KeyboardEvent} */ event) => {
    if (event.key !== "Tab") return;
    const all = /** @type {HTMLElement[]} */ ([
      ...box.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"),
    ]).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (all.length === 0) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  /** A modal dialog; the returned close() removes it. @param {DialogSpec} spec */
  const dialog = (spec) => {
    closeTop?.();
    const before = /** @type {HTMLElement | null} */ (doc.activeElement);
    const close = () => {
      scrim.remove();
      if (closeTop === close) closeTop = null;
      spec.onClose?.();
      before?.focus?.();
    };
    const box = h(
      `section.desk-dialog.dialog${spec.wide ? ".wide" : ""}${spec.cls ? `.${spec.cls}` : ""}`,
      { role: "dialog", "aria-modal": "true", "aria-label": spec.title },
      h(
        "header.dialog-head",
        null,
        spec.icon ? h("span.dialog-icon", null, icon(spec.icon, 20)) : null,
        h(
          "div.dialog-titles",
          null,
          h("h2", null, spec.title),
          spec.subtitle ? h("p", null, spec.subtitle) : null,
        ),
        button({ label: "Close", icon: "x", hideLabel: true, onClick: close }),
      ),
      h("div.dialog-body", null, spec.body),
      spec.actions?.length ? h("footer.dialog-foot", null, spec.actions) : null,
    );
    const scrim = h(
      "div.desk-scrim.scrim",
      {
        onMousedown: (/** @type {MouseEvent} */ e) => {
          if (e.target === scrim) close();
        },
      },
      box,
    );
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else trap(box, event);
    });
    layer.append(scrim);
    closeTop = close;
    queueMicrotask(() => {
      const first = /** @type {HTMLElement | null} */ (
        box.querySelector(
          "[autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-foot .desk-btn-primary",
        )
      );
      (first ?? box.querySelector("button"))?.focus();
    });
    return { close, element: box };
  };

  /**
   * A menu at a point or under an element; resolves when it closes.
   * @param {MenuItem[]} items @param {{ x: number, y: number } | HTMLElement} at
   */
  const menu = (items, at) => {
    closeTop?.();
    const list = h("div.desk-menu.menu", { role: "menu" });
    const close = () => {
      catcher.remove();
      if (closeTop === close) closeTop = null;
    };
    for (const item of items) {
      if (item === "-") {
        list.append(h("div.menu-sep", { role: "separator" }));
        continue;
      }
      list.append(
        h(
          `button.desk-btn.desk-btn-quiet.menu-item${item.danger ? ".danger" : ""}`,
          {
            type: "button",
            role: "menuitem",
            disabled: item.disabled,
            onClick: () => {
              close();
              item.run?.();
            },
          },
          item.icon ? icon(item.icon) : h("span.menu-gap"),
          h("span.menu-label", null, item.label),
          item.hint ? h("kbd", null, item.hint) : null,
        ),
      );
    }
    const catcher = h(
      "div.menu-catcher",
      {
        onMousedown: (/** @type {MouseEvent} */ e) => {
          if (e.target === catcher) close();
        },
        onContextmenu: (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          close();
        },
      },
      list,
    );
    layer.append(catcher);
    const rect =
      at instanceof HTMLElement
        ? at.getBoundingClientRect()
        : { left: at.x, bottom: at.y, right: at.x, top: at.y };
    const box = list.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    let left = at instanceof HTMLElement ? rect.right - box.width : rect.left;
    let top = rect.bottom + 4;
    if (left + box.width > vw - 8) left = vw - box.width - 8;
    if (top + box.height > vh - 8) top = Math.max(8, rect.top - box.height - 4);
    list.style.left = `${Math.max(8, left)}px`;
    list.style.top = `${top}px`;
    list.addEventListener("keydown", (event) => {
      const buttons = /** @type {HTMLElement[]} */ ([
        ...list.querySelectorAll("button:not([disabled])"),
      ]);
      const at = buttons.indexOf(/** @type {HTMLElement} */ (doc.activeElement));
      if (event.key === "Escape") close();
      else if (event.key === "ArrowDown") buttons[(at + 1) % buttons.length]?.focus();
      else if (event.key === "ArrowUp")
        buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
      else return;
      event.preventDefault();
    });
    /** @type {HTMLElement | null} */ (list.querySelector("button:not([disabled])"))?.focus();
    closeTop = close;
  };

  /**
   * Ask before doing what cannot be undone; resolves true when the person agrees.
   * @param {{ title: string, text: string, ok: string, danger?: boolean, detail?: HTMLElement }} spec
   */
  const confirm = (spec) =>
    new Promise((resolve) => {
      let answered = false;
      const answer = (/** @type {boolean} */ yes) => {
        answered = true;
        d.close();
        resolve(yes);
      };
      const d = dialog({
        title: spec.title,
        icon: spec.danger ? "alert" : "info",
        cls: spec.danger ? "danger" : "",
        body: [h("p.confirm-text", null, spec.text), ...(spec.detail ? [spec.detail] : [])],
        actions: [
          button({ label: "Cancel", kind: "desk-btn-quiet", onClick: () => answer(false) }),
          button({
            label: spec.ok,
            kind: spec.danger ? "desk-btn-danger" : "desk-btn-primary",
            onClick: () => answer(true),
            attrs: { autofocus: true },
          }),
        ],
        onClose: () => {
          if (!answered) resolve(false);
        },
      });
    });

  /** @param {string} text @param {"info" | "success" | "danger"} kind */
  const toast = (text, kind = "info") => {
    const el = h(
      `div.toast.${kind}`,
      null,
      icon(kind === "danger" ? "alert" : kind === "success" ? "check" : "info"),
      h("span", null, text),
    );
    toasts.append(el);
    while (toasts.children.length > 4) toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add("leaving"), kind === "danger" ? 7000 : 3600);
    setTimeout(() => el.remove(), kind === "danger" ? 7400 : 4000);
  };

  return { dialog, menu, confirm, toast, open: () => closeTop !== null, close: () => closeTop?.() };
}

/** @typedef {ReturnType<typeof createOverlay>} Overlay */
