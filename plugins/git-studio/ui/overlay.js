// What floats over the window: a dialog that asks (a confirm, or a small form of fields) and a
// context menu, both on the design system's kit classes, both answered from the keyboard too.

import { h, icon } from "./dom.js";

/**
 * @typedef {{ name: string, label: string, kind?: "text" | "check" | "select" | "textarea", value?: string | boolean,
 *   placeholder?: string, options?: { value: string, label: string }[], hint?: string, mono?: boolean }} Field
 * @typedef {{ title: string, body?: string | Node, fields?: Field[], confirm: string, danger?: boolean,
 *   cancel?: string, icon?: keyof typeof import("./icons.js").ICONS,
 *   check?(values: Record<string, string | boolean>): string | null }} Ask
 * @typedef {{ label: string, icon?: keyof typeof import("./icons.js").ICONS, hint?: string, danger?: boolean,
 *   disabled?: boolean, run?(): void, items?: MenuItem[] }} MenuEntry
 * @typedef {MenuEntry | "-"} MenuItem
 */

/**
 * Ask the person; resolves with the fields' values on confirm, null on cancel.
 * @param {HTMLElement} layer @param {Ask} spec
 * @returns {Promise<Record<string, string | boolean> | null>}
 */
export function ask(layer, spec) {
  return new Promise((resolve) => {
    /** @type {Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>} */
    const inputs = new Map();
    const error = h("p.dialog-error", { role: "alert", hidden: true });
    const fields = (spec.fields ?? []).map((field) => {
      const id = `f-${field.name}`;
      if (field.kind === "check") {
        const input = /** @type {HTMLInputElement} */ (
          h("input.desk-check", { type: "checkbox", id, checked: field.value === true })
        );
        inputs.set(field.name, input);
        return h(
          "label.dialog-check",
          { for: id },
          input,
          h("span", null, field.label, field.hint ? h("small.desk-muted", null, field.hint) : null),
        );
      }
      const input =
        field.kind === "select"
          ? h(
              "select.desk-field",
              { id },
              ...(field.options ?? []).map((o) =>
                h("option", { value: o.value, selected: o.value === field.value }, o.label),
              ),
            )
          : field.kind === "textarea"
            ? h("textarea.desk-field", { id, rows: 4, placeholder: field.placeholder ?? "" })
            : h("input.desk-field", {
                id,
                type: "text",
                value: String(field.value ?? ""),
                placeholder: field.placeholder ?? "",
                spellcheck: "false",
                autocomplete: "off",
              });
      if (field.mono) input.classList.add("is-mono");
      if (field.kind === "textarea")
        /** @type {HTMLTextAreaElement} */ (input).value = String(field.value ?? "");
      inputs.set(field.name, /** @type {HTMLInputElement} */ (input));
      return h(
        "label.dialog-field",
        { for: id },
        h("span", null, field.label),
        input,
        field.hint ? h("small.desk-muted", null, field.hint) : null,
      );
    });
    const values = () => {
      /** @type {Record<string, string | boolean>} */
      const out = {};
      for (const [name, input] of inputs)
        out[name] =
          input instanceof HTMLInputElement && input.type === "checkbox"
            ? input.checked
            : input.value.trim();
      return out;
    };
    const done = (/** @type {Record<string, string | boolean> | null} */ result) => {
      scrim.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const submit = () => {
      const result = values();
      const problem = spec.check?.(result) ?? null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      done(result);
    };
    const onKey = (/** @type {KeyboardEvent} */ event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done(null);
      } else if (
        event.key === "Enter" &&
        !(event.target instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey)
      ) {
        event.preventDefault();
        submit();
      }
    };
    const confirm = h(
      `button.desk-btn.${spec.danger ? "desk-btn-danger" : "desk-btn-primary"}`,
      { type: "button", onClick: submit },
      spec.confirm,
    );
    const dialog = h(
      "div.desk-dialog.dialog",
      { role: "dialog", "aria-modal": "true", "aria-label": spec.title },
      h(
        "div.dialog-head",
        null,
        spec.icon
          ? h("span.dialog-icon", { class: spec.danger ? "is-danger" : "" }, icon(spec.icon, 18))
          : null,
        h("h2", null, spec.title),
      ),
      spec.body ? h("div.dialog-body", null, spec.body) : null,
      fields.length ? h("div.dialog-fields", null, ...fields) : null,
      error,
      h(
        "div.dialog-actions",
        null,
        h(
          "button.desk-btn.desk-btn-quiet",
          { type: "button", onClick: () => done(null) },
          spec.cancel ?? "Cancel",
        ),
        confirm,
      ),
    );
    const scrim = h(
      "div.desk-scrim.dialog-scrim",
      { onMousedown: (/** @type {MouseEvent} */ e) => e.target === scrim && done(null) },
      dialog,
    );
    layer.append(scrim);
    document.addEventListener("keydown", onKey, true);
    const first = inputs.values().next().value;
    (first ?? confirm).focus();
    if (first instanceof HTMLInputElement && first.type === "text") first.select();
  });
}

/** Ask yes or no. @param {HTMLElement} layer @param {Omit<Ask, "fields">} spec */
export async function confirm(layer, spec) {
  return (await ask(layer, spec)) !== null;
}

/**
 * A context menu at a point; picking an entry runs it. Arrow keys move, Enter picks, Escape closes.
 * @param {HTMLElement} layer @param {{ x: number, y: number }} at @param {MenuItem[]} items
 */
export function menu(layer, at, items) {
  closeMenus(layer);
  const root = list(items);
  layer.append(root);
  const { innerWidth, innerHeight } = window;
  const box = root.getBoundingClientRect();
  root.style.left = `${Math.min(at.x, innerWidth - box.width - 8)}px`;
  root.style.top = `${Math.min(at.y, innerHeight - box.height - 8)}px`;
  const close = () => {
    closeMenus(layer);
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const outside = (/** @type {MouseEvent} */ e) => {
    if (!(/** @type {Element} */ (e.target).closest(".ctx-menu"))) close();
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    const entries = /** @type {HTMLElement[]} */ ([
      ...root.querySelectorAll(":scope > .ctx-item:not([disabled])"),
    ]);
    const at = entries.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        entries[(at + (e.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length];
      next?.focus();
    } else return;
    e.stopPropagation();
  };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", onKey, true);
  /** @type {HTMLElement | null} */ (root.querySelector(".ctx-item:not([disabled])"))?.focus();

  /** @param {MenuItem[]} entries @returns {HTMLElement} */
  function list(entries) {
    return h(
      "div.desk-menu.ctx-menu",
      { role: "menu" },
      ...entries.map((item) => {
        if (item === "-") return h("div.ctx-sep", { role: "separator" });
        const button = h(
          "button.desk-row.ctx-item",
          {
            type: "button",
            role: "menuitem",
            disabled: item.disabled,
            class: item.danger ? "is-danger" : "",
            onClick: () => {
              if (item.items) return;
              close();
              item.run?.();
            },
          },
          item.icon ? icon(item.icon, 15) : h("span.ctx-blank"),
          h("span.ctx-label", null, item.label),
          item.hint ? h("span.ctx-hint", null, item.hint) : null,
          item.items ? icon("chevronRight", 13) : null,
        );
        if (!item.items) return button;
        const sub = list(item.items);
        sub.classList.add("ctx-sub");
        return h("div.ctx-parent", null, button, sub);
      }),
    );
  }
  return close;
}

export function closeMenus(/** @type {HTMLElement} */ layer) {
  for (const el of layer.querySelectorAll(".ctx-menu")) el.remove();
}
