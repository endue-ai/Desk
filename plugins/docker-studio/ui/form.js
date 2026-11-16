// The parts the dialogs are built of: a labelled field, a select, a checkbox, and a list of rows to
// add to and remove from (ports, volumes, variables), each control a design system component.

import { button, h } from "./dom.js";

/** A labelled field with an optional hint under it. */
export function field(
  /** @type {string} */ label,
  /** @type {HTMLElement} */ control,
  hint = "",
  cls = "",
) {
  return h(
    `label.field${cls ? `.${cls}` : ""}`,
    null,
    h("span.field-label", null, label),
    control,
    hint ? h("small.field-hint", null, hint) : null,
  );
}

/** A text input of the kit. @param {{ value?: string, placeholder?: string, mono?: boolean, onInput?: (value: string) => void, label?: string, list?: string }} o */
export function input(o = {}) {
  const el = /** @type {HTMLInputElement} */ (
    h(`input.desk-field${o.mono ? ".mono" : ""}`, {
      type: "text",
      value: o.value ?? "",
      placeholder: o.placeholder ?? "",
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": o.label,
      list: o.list,
      onInput: () => o.onInput?.(el.value),
    })
  );
  return el;
}

/** A select of the kit. @param {Array<[string, string]>} options @param {string} value @param {(value: string) => void} onChange */
export function select(options, value, onChange, label = "") {
  const el = /** @type {HTMLSelectElement} */ (
    h(
      "select.desk-field",
      { "aria-label": label || undefined, onChange: () => onChange(el.value) },
      options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)),
    )
  );
  return el;
}

/** A checkbox of the kit with its label. */
export function check(
  /** @type {string} */ label,
  /** @type {boolean} */ value,
  /** @type {(on: boolean) => void} */ onChange,
) {
  const box = /** @type {HTMLInputElement} */ (
    h("input.desk-check", {
      type: "checkbox",
      checked: value,
      onChange: () => onChange(box.checked),
    })
  );
  return h("label.check", null, box, h("span", null, label));
}

/**
 * Rows to add to and remove from; `row(item, change)` draws one row's controls.
 * @template T
 * @param {{ title: string, items: T[], make: () => T, row: (item: T, changed: () => void) => HTMLElement[], changed: () => void, add: string, empty?: string }} spec
 */
export function rows(spec) {
  const list = h("div.rows-list");
  const draw = () => {
    list.replaceChildren(
      ...spec.items.map((item, i) =>
        h(
          "div.rows-item",
          null,
          ...spec.row(item, spec.changed),
          button({
            label: "Remove this row",
            icon: "x",
            hideLabel: true,
            onClick: () => {
              spec.items.splice(i, 1);
              draw();
              spec.changed();
            },
          }),
        ),
      ),
    );
    if (spec.items.length === 0 && spec.empty) list.append(h("p.rows-empty", null, spec.empty));
  };
  draw();
  return h(
    "fieldset.rows-set",
    null,
    h("legend", null, spec.title),
    list,
    button({
      label: spec.add,
      icon: "plus",
      kind: "desk-btn-quiet link",
      onClick: () => {
        spec.items.push(spec.make());
        draw();
        spec.changed();
        /** @type {HTMLInputElement | null} */ (
          list.querySelector(".rows-item:last-child input")
        )?.focus();
      },
    }),
  );
}
