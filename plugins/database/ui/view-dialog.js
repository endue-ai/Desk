// A feature's dialog over the page (feature-host.js): one at a time, drawn by its type's module in
// the page's main area beside the built-in dialogs, its first field focused; Escape cancels, and
// the focus goes back to where it was when it closes. One opened while another shows cancels it.

/** @typedef {import("./feature-host.js").Dialog} Dialog */

/**
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {Record<string, Dialog>} dialogs by type
 */
export function createDialogs(doc, host, dialogs) {
  /** @type {{ close(answer?: unknown): void } | null} */
  let shown = null;

  return {
    /** Show a dialog; resolves with its answer, or undefined when it was cancelled. */
    show(/** @type {string} */ type, /** @type {unknown} */ model) {
      const dialog = Object.hasOwn(dialogs, type) ? dialogs[type] : undefined;
      if (!dialog) return Promise.reject(new Error(`No feature draws a ${type} dialog.`));
      shown?.close(undefined);
      const before = /** @type {HTMLElement | null} */ (doc.activeElement);
      return new Promise((resolve) => {
        /** @type {HTMLElement | undefined} */
        let form;
        const handle = {
          close(/** @type {unknown} */ answer) {
            if (shown !== handle) return;
            shown = null;
            form?.remove();
            if (before?.isConnected && typeof before.focus === "function") before.focus();
            resolve(answer);
          },
        };
        shown = handle;
        form = dialog.render(doc, model, (answer) => handle.close(answer));
        if (!form.hasAttribute("aria-labelledby")) form.setAttribute("aria-label", dialog.label);
        form.addEventListener("keydown", (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          handle.close(undefined);
        });
        form.hidden = false;
        host.append(form);
        /** @type {HTMLElement | null} */ (
          form.querySelector("input, select, textarea, button")
        )?.focus();
      });
    },
  };
}
