// The table form's controls (PG-51), on the desk's kit classes: a labelled field (a line, a box of
// lines, a list to pick from), a check box, an ordered pick of columns, a list of keys (a column or
// an expression each), and the list of a section's parts with the one shown selected. Each control
// has a `data-key` so the focus comes back to it after a redraw, and calls back with its value: a
// line on each keystroke (the form draws itself again once the line is left, panel.js), the rest
// when they change.
// Layout and colours: table-design.css.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {(value: string, redraw: false) => void} OnText
 * @typedef {{ id: string, name: string }} Named
 * @typedef {import("./model.js").Key} Key
 * @typedef {{ id: string, title: string, detail?: string, badge?: string, struck?: boolean }} Item
 */

/** A labelled line or box of lines. */
export function textField(
  /** @type {Document} */ doc,
  /** @type {{ key: string, label: string, value: string, hint?: string, list?: string[], placeholder?: string, disabled?: boolean, area?: boolean, mono?: boolean }} */ f,
  /** @type {OnText} */ on,
) {
  const id = `td-${f.key.replace(/[^\w-]/gu, "-")}`;
  const attrs = {
    id,
    class: `desk-field${f.mono ? " td-mono" : ""}`,
    "data-key": f.key,
    spellcheck: "false",
    autocomplete: "off",
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    ...(f.disabled ? { disabled: true } : {}),
    ...(f.list?.length ? { list: `${id}-list` } : {}),
  };
  const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (
    el(doc, f.area ? "textarea" : "input", f.area ? { ...attrs, rows: "2" } : attrs)
  );
  input.value = f.value;
  input.addEventListener("input", () => on(input.value, false));
  const list = f.list?.length
    ? el(
        doc,
        "datalist",
        { id: `${id}-list` },
        ...f.list.map((v) => el(doc, "option", { value: v })),
      )
    : undefined;
  return el(
    doc,
    "label",
    { class: "td-field", for: id },
    el(doc, "span", { class: "td-label" }, f.label),
    input,
    list,
    f.hint ? el(doc, "span", { class: "td-hint" }, f.hint) : undefined,
  );
}

/** A labelled list to pick one of. */
export function selectField(
  /** @type {Document} */ doc,
  /** @type {{ key: string, label: string, value: string, options: { value: string, label: string }[], disabled?: boolean, hint?: string }} */ f,
  /** @type {(value: string) => void} */ on,
) {
  const id = `td-${f.key.replace(/[^\w-]/gu, "-")}`;
  const select = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { id, class: "desk-field", "data-key": f.key, ...(f.disabled ? { disabled: true } : {}) },
      ...f.options.map((o) => el(doc, "option", { value: o.value }, o.label)),
    )
  );
  select.value = f.value;
  select.addEventListener("change", () => on(select.value));
  return el(
    doc,
    "label",
    { class: "td-field", for: id },
    el(doc, "span", { class: "td-label" }, f.label),
    select,
    f.hint ? el(doc, "span", { class: "td-hint" }, f.hint) : undefined,
  );
}

/** A check box with its label and why it is off. */
export function checkField(
  /** @type {Document} */ doc,
  /** @type {{ key: string, label: string, checked: boolean, disabled?: boolean, hint?: string }} */ f,
  /** @type {(checked: boolean) => void} */ on,
) {
  const box = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      type: "checkbox",
      class: "desk-check",
      "data-key": f.key,
      ...(f.disabled ? { disabled: true } : {}),
    })
  );
  box.checked = f.checked;
  box.addEventListener("change", () => on(box.checked));
  return el(
    doc,
    "label",
    { class: "td-check" },
    box,
    ` ${f.label}`,
    f.hint ? el(doc, "span", { class: "td-hint" }, f.hint) : undefined,
  );
}

/** An ordered pick of columns: each picked one with its remove button, and a list to add one. */
export function columnsPick(
  /** @type {Document} */ doc,
  /** @type {{ key: string, label: string, ids: string[], columns: Named[], disabled?: boolean }} */ f,
  /** @type {(ids: string[]) => void} */ on,
) {
  const named = new Map(f.columns.map((c) => [c.id, c.name || "(no name)"]));
  const chips = f.ids.map((id, i) =>
    el(
      doc,
      "span",
      { class: "td-chip" },
      el(doc, "span", { class: "td-mono" }, named.get(id) ?? t("features.tableDesign.bits.gone")),
      f.disabled
        ? undefined
        : remove(doc, `${f.key}:x${i}`, `Take ${named.get(id) ?? "it"} out`, () =>
            on(f.ids.filter((x) => x !== id)),
          ),
    ),
  );
  const left = f.columns.filter((c) => !f.ids.includes(c.id));
  const add = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      {
        class: "desk-field td-add",
        "data-key": `${f.key}:add`,
        "aria-label": t("features.tableDesign.bits.addAColumnTo", {
          value: String(f.label.toLowerCase()),
        }),
        ...(f.disabled || left.length === 0 ? { disabled: true } : {}),
      },
      el(
        doc,
        "option",
        { value: "" },
        left.length
          ? t("features.tableDesign.bits.addAColumn")
          : t("features.tableDesign.bits.noMoreColumns"),
      ),
      ...left.map((c) =>
        el(doc, "option", { value: c.id }, c.name || t("features.tableDesign.bits.noName")),
      ),
    )
  );
  add.addEventListener("change", () => add.value && on([...f.ids, add.value]));
  return el(
    doc,
    "div",
    { class: "td-field", role: "group", "aria-label": f.label },
    el(doc, "span", { class: "td-label" }, f.label),
    el(doc, "div", { class: "td-chips" }, ...chips, add),
  );
}

/** A list of keys, each a column or an expression, with a button to add one. */
export function keysPick(
  /** @type {Document} */ doc,
  /** @type {{ key: string, label: string, keys: Key[], columns: Named[], disabled?: boolean }} */ f,
  /** @type {(keys: Key[], redraw: boolean) => void} */ on,
) {
  const rows = f.keys.map((k, i) => {
    const pick = /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        {
          class: "desk-field",
          "data-key": `${f.key}:${i}:pick`,
          "aria-label": t("features.tableDesign.bits.key", { value: String(i + 1) }),
          ...(f.disabled ? { disabled: true } : {}),
        },
        ...f.columns.map((c) =>
          el(doc, "option", { value: c.id }, c.name || t("features.tableDesign.bits.noName")),
        ),
        el(doc, "option", { value: "" }, t("features.tableDesign.bits.anExpression")),
      )
    );
    pick.value = k.column;
    const swap = (/** @type {Key} */ next) => f.keys.map((x, j) => (j === i ? next : x));
    pick.addEventListener("change", () => on(swap({ column: pick.value, expression: "" }), true));
    const expression = k.column
      ? undefined
      : textField(
          doc,
          {
            key: `${f.key}:${i}:expr`,
            label: t("features.tableDesign.bits.expression"),
            value: k.expression,
            placeholder: t("features.tableDesign.bits.lowerName"),
            mono: true,
            disabled: f.disabled,
          },
          (value) => on(swap({ column: "", expression: value }), false),
        );
    return el(
      doc,
      "div",
      { class: "td-key" },
      pick,
      expression,
      f.disabled
        ? undefined
        : remove(doc, `${f.key}:${i}:x`, `Remove key ${i + 1}`, () =>
            on(
              f.keys.filter((_, j) => j !== i),
              true,
            ),
          ),
    );
  });
  const add = el(
    doc,
    "button",
    {
      type: "button",
      class: "desk-btn desk-btn-quiet",
      "data-key": `${f.key}:add`,
      ...(f.disabled ? { disabled: true } : {}),
    },
    t("features.tableDesign.bits.addAKey"),
  );
  add.addEventListener("click", () =>
    on([...f.keys, { column: f.columns[0]?.id ?? "", expression: "" }], true),
  );
  return el(
    doc,
    "div",
    { class: "td-field", role: "group", "aria-label": f.label },
    el(doc, "span", { class: "td-label" }, f.label),
    el(doc, "div", { class: "td-keys" }, ...rows, add),
  );
}

/** A section's parts, the one shown selected, and the button that adds one. */
export function itemList(
  /** @type {Document} */ doc,
  /** @type {{ key: string, label: string, items: Item[], selected: string, add?: string }} */ f,
  /** @type {(id: string) => void} */ pick,
  /** @type {(() => void) | undefined} */ add,
) {
  const rows = f.items.map((item) => {
    const row = el(
      doc,
      "button",
      {
        type: "button",
        class: `desk-row td-item${item.struck ? " td-struck" : ""}`,
        "data-key": `${f.key}:${item.id}`,
        "aria-pressed": String(item.id === f.selected),
      },
      el(doc, "span", { class: "td-item-title" }, item.title),
      item.detail ? el(doc, "span", { class: "td-item-detail" }, item.detail) : undefined,
      item.badge ? el(doc, "span", { class: "desk-badge" }, item.badge) : undefined,
    );
    row.addEventListener("click", () => pick(item.id));
    return row;
  });
  const adder = add
    ? el(
        doc,
        "button",
        { type: "button", class: "desk-btn", "data-key": `${f.key}:add` },
        f.add ?? t("features.tableDesign.bits.add"),
      )
    : undefined;
  adder?.addEventListener("click", () => add?.());
  return el(
    doc,
    "div",
    { class: "td-list", role: "group", "aria-label": f.label },
    ...(rows.length
      ? rows
      : [el(doc, "p", { class: "td-hint" }, t("features.tableDesign.bits.noneYet"))]),
    adder,
  );
}

/** A small remove button. */
function remove(
  /** @type {Document} */ doc,
  /** @type {string} */ key,
  /** @type {string} */ label,
  /** @type {() => void} */ on,
) {
  const button = el(
    doc,
    "button",
    {
      type: "button",
      class: "desk-icon-btn td-remove",
      "data-key": key,
      "aria-label": label,
      title: label,
    },
    "×",
  );
  button.addEventListener("click", on);
  return button;
}
