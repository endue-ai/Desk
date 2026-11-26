// The array editor (PG-40): a one-dimensional array as a list of its elements, each a field checked
// by the element type's editor (a number, a label, a date ...) and NULL apart from the text 'NULL';
// Add element, Remove, Enter adds one after, Backspace in an empty one removes it, the arrows move,
// Mod+Enter keeps. The value is PostgreSQL's array text (pg-array.js). A nested array is edited as
// its text, its braces checked.

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { field, textOf } from "./panel.js";
import { balanced, formatArray, parseArray } from "./pg-array.js";
import { checkValue } from "./values.js";

/** @typedef {import("./resolve.js").Editor} Editor */

/**
 * The elements' values checked by the element's editor, as the array's text.
 * @param {(string | null)[]} elements
 * @param {Editor} editor
 */
function checkElements(elements, editor) {
  /** @type {(string | null)[]} */
  const out = [];
  for (const [i, element] of elements.entries()) {
    if (element === null || !editor.element) {
      out.push(element);
      continue;
    }
    const done = checkValue(editor.element, element);
    if ("error" in done) return { error: `The array's element ${i + 1}: ${done.error}` };
    out.push(done.value);
  }
  return { value: formatArray(out) };
}

export const array = {
  /** @param {string} text @param {Editor} editor */
  check(text, editor) {
    const parsed = parseArray(text);
    if ("error" in parsed) return parsed;
    if ("nested" in parsed)
      return balanced(text)
        ? { value: text.trim() }
        : { error: t("cellEditors.array.theBracesOfThisNestedArray") };
    return checkElements(parsed.elements, editor);
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const { doc, editor } = ctx;
    const parsed = parseArray(textOf(ctx.value) || "{}");
    if (!("elements" in parsed)) {
      const f = field(ctx, {
        check: (text) => array.check(text, editor),
        multiline: true,
        example: "{{1,2},{3,4}}",
      });
      return { el: f.input, read: f.read, focus: f.focus, multiline: true };
    }
    const list = el(doc, "ol", {
      class: "cell-editor-elements",
      tabindex: "-1",
      "aria-label": t("cellEditors.array.sElements", { name: String(ctx.name) }),
    });
    /** @type {{ input: HTMLInputElement, nil: HTMLButtonElement, item: HTMLElement }[]} */
    const rows = [];
    const isNull = (/** @type {typeof rows[number]} */ row) =>
      row.nil.getAttribute("aria-pressed") === "true";
    const number = () =>
      rows.forEach((row, i) => {
        row.input.setAttribute(
          "aria-label",
          t("cellEditors.array.element", { value: String(i + 1) }),
        );
      });
    const add = (/** @type {string | null} */ value, at = rows.length) => {
      const input = /** @type {HTMLInputElement} */ (
        el(doc, "input", { class: "desk-field cell-editor-element", spellcheck: "false" })
      );
      const nil = /** @type {HTMLButtonElement} */ (
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-btn desk-btn-quiet",
            "data-do": "null-element",
            title: t("cellEditors.array.thisElementIsNull"),
          },
          t("cellEditors.array.null"),
        )
      );
      const remove = el(
        doc,
        "button",
        { type: "button", class: "desk-btn desk-btn-quiet", "data-do": "remove" },
        t("cellEditors.array.remove"),
      );
      const item = el(doc, "li", {}, input, nil, remove);
      const row = { input, nil, item };
      const setNull = (/** @type {boolean} */ on) => {
        nil.setAttribute("aria-pressed", String(on));
        input.placeholder = on ? t("cellEditors.array.null") : "";
        if (on) input.value = "";
      };
      input.value = value ?? "";
      setNull(value === null);
      input.addEventListener("input", () => {
        if (input.value) setNull(false);
        ctx.clear();
      });
      nil.addEventListener("click", () => setNull(nil.getAttribute("aria-pressed") !== "true"));
      remove.addEventListener("click", () => drop(row));
      input.addEventListener("keydown", (event) => {
        if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
        const i = rows.indexOf(row);
        if (event.key === "Enter") add("", i + 1).focus();
        else if (event.key === "Backspace" && input.value === "" && !isNull(row)) drop(row, true);
        else if (event.key === "ArrowDown") rows[i + 1]?.input.focus();
        else if (event.key === "ArrowUp") rows[i - 1]?.input.focus();
        else return;
        event.preventDefault();
        event.stopPropagation();
      });
      rows.splice(at, 0, row);
      list.insertBefore(item, rows[at + 1]?.item ?? null);
      number();
      return input;
    };
    const drop = (/** @type {typeof rows[number]} */ row, back = false) => {
      const i = rows.indexOf(row);
      rows.splice(i, 1);
      row.item.remove();
      number();
      (rows[back ? Math.max(0, i - 1) : Math.min(i, rows.length - 1)]?.input ?? list).focus();
    };
    for (const element of parsed.elements) add(element);
    return {
      el: list,
      multiline: true,
      focus: () => (rows[0]?.input ?? list).focus(),
      read() {
        if (rows.length === 0 && (ctx.value === null || textOf(ctx.value) === ""))
          return { value: ctx.value };
        return checkElements(
          rows.map((row) => (isNull(row) ? null : row.input.value)),
          editor,
        );
      },
      tools: [
        {
          label: t("cellEditors.array.addElement"),
          name: "add",
          key: "KeyA",
          run: () => add("").focus(),
        },
      ],
    };
  },
};
