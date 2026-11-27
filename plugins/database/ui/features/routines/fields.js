// One row of a routine's form per argument (PG-56): its name, type, mode and default, then for an
// argument the call gives a choice of a value, NULL or DEFAULT (DEFAULT only where it has one) and
// the value's editor by its type, the typed cell editors' own view (ADR 0287) drawn in the row
// instead of a popover: a toggle for a boolean, an enum's labels, a date with its picker, JSON with
// Format, VARIADIC and arrays as a list of elements. What the type refuses is said under the row as
// the person types. A polymorphic argument also takes the type it is given as. An OUT or TABLE
// argument says where its value comes back. Keys in a row: the editor's own, Alt+N NULL, Alt+D
// DEFAULT, Alt+V a value, and the editor's tools with Alt.

import { field } from "../../cell-editors/panel.js";
import { checkValue, KINDS } from "../../cell-editors/values.js";
import { el } from "../../dom.js";
import { t as messageText } from "../../strings/index.js";
import { inputOf, labelOf, polymorphic } from "./call.js";
import { modeOf } from "./entries.js";

/**
 * @typedef {import("./read.js").Routine} Routine
 * @typedef {import("./read.js").Arg} Arg
 * @typedef {import("./call.js").Entry} Entry
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {{ el: HTMLElement, read(): Entry | undefined, focus(): void }} Row
 */

const CHOICES = /** @type {const} */ ([
  ["value", "Value", "KeyV"],
  ["null", "NULL", "KeyN"],
  ["default", "DEFAULT", "KeyD"],
]);

/** The line under a name: its type, its mode and its default. */
function headOf(/** @type {Document} */ doc, /** @type {Routine} */ r, /** @type {Arg} */ a) {
  return el(
    doc,
    "div",
    { class: "routine-arg-head" },
    el(doc, "span", { class: "routine-arg-name" }, labelOf(r, a)),
    el(doc, "span", { class: "desk-badge" }, modeOf(a)),
    el(doc, "span", { class: "routine-arg-type desk-muted" }, a.type),
    a.default !== null
      ? el(
          doc,
          "span",
          { class: "routine-arg-default desk-muted" },
          messageText("features.routines.fields.default", { default: String(a.default) }),
        )
      : undefined,
  );
}

/** The row of an argument the call does not give: where its value comes back. */
function outRow(/** @type {Document} */ doc, /** @type {Routine} */ r, /** @type {Arg} */ a) {
  const said =
    r.kind === "procedure"
      ? messageText("features.routines.fields.passedAsNullItsValueComes")
      : messageText("features.routines.fields.comesBackAsAColumnOf");
  return {
    el: el(
      doc,
      "div",
      { class: "routine-arg routine-arg-out", "data-arg": String(a.position) },
      headOf(doc, r, a),
      el(doc, "p", { class: "desk-muted routine-arg-note" }, said),
    ),
    read: () => undefined,
    focus: () => {},
  };
}

/**
 * @param {Document} doc
 * @param {Routine} r
 * @param {Arg} a
 * @param {Entry} entry
 * @param {{ act: Act, changed(): void }} hooks
 * @returns {Row}
 */
export function argumentRow(doc, r, a, entry, hooks) {
  if (!inputOf(r, a) || (r.kind === "procedure" && a.mode === "o")) return outRow(doc, r, a);
  const label = labelOf(r, a);
  const error = el(doc, "p", {
    class: "desk-error routine-arg-error",
    role: "alert",
    hidden: true,
  });
  const fail = (/** @type {string} */ why) => {
    error.textContent = why;
    error.hidden = why === "";
  };
  let choice = entry.choice === "default" && a.default === null ? "value" : entry.choice;
  let last = entry.value;
  /** @type {import("../../cell-editors/panel.js").Ctx} */
  const ctx = {
    doc,
    editor: a.editor,
    value: entry.value,
    name: label,
    act: hooks.act,
    keep: () => hooks.changed(),
    fail,
    clear: () => fail(""),
  };
  const make = KINDS[a.editor.kind]?.view;
  const view = make
    ? make(ctx)
    : (() => {
        const f = field(ctx, { check: (text) => ({ value: text }), example: "text" });
        return { el: f.input, read: f.read, focus: f.focus };
      })();
  const tools = (view.tools ?? []).map((tool) => {
    const b = el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-quiet", "data-do": tool.name },
      tool.label,
    );
    b.addEventListener("click", () => {
      tool.run();
      hooks.changed();
    });
    return b;
  });
  const editor = el(
    doc,
    "div",
    { class: "routine-arg-editor" },
    view.el,
    tools.length ? el(doc, "div", { class: "routine-arg-tools" }, ...tools) : undefined,
  );
  const cast = polymorphic(a)
    ? /** @type {HTMLInputElement} */ (
        el(doc, "input", {
          class: "desk-field routine-arg-cast",
          "data-cast": String(a.position),
          "aria-label": messageText("features.routines.fields.theTypeItIsGivenAs", {
            label: String(label),
          }),
          spellcheck: "false",
          placeholder:
            a.mode === "v"
              ? messageText("features.routines.fields.text")
              : messageText("features.routines.fields.text2"),
        })
      )
    : undefined;
  if (cast) cast.value = entry.cast ?? "";
  const offered = CHOICES.filter(([value]) => value !== "default" || a.default !== null);
  const buttons = offered.map(([value, text, key]) =>
    el(
      doc,
      "button",
      {
        type: "button",
        class: "desk-tab",
        "data-choice": value,
        title: messageText("features.routines.fields.alt", { value: String(key.slice(3)) }),
      },
      text,
    ),
  );
  const pick = (/** @type {string} */ value) => {
    choice = /** @type {Entry["choice"]} */ (value);
    buttons.forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.choice === choice));
    });
    editor.hidden = choice !== "value";
    if (choice !== "value") fail("");
  };
  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      pick(b.dataset.choice ?? messageText("features.routines.fields.value"));
      hooks.changed();
    });
  });
  pick(choice);

  /** @returns {Entry} */
  const read = () => {
    const kind = cast?.value.trim() ? { cast: cast.value.trim() } : {};
    if (choice !== "value") return { choice, value: last, ...kind };
    const done = view.read();
    const value = "error" in done ? undefined : (done.value ?? "");
    const checked = value === undefined ? done : checkValue(a.editor, value);
    const why = "error" in checked ? checked.error : "";
    fail(why);
    if (value !== undefined) last = value;
    return { choice, value: last, ...(why ? { error: why } : {}), ...kind };
  };

  const row = el(
    doc,
    "div",
    { class: "routine-arg", "data-arg": String(a.position) },
    headOf(doc, r, a),
    el(
      doc,
      "div",
      { class: "routine-arg-line" },
      el(
        doc,
        "div",
        {
          class: "desk-tabs routine-arg-choice",
          role: "group",
          "aria-label": messageText("features.routines.fields.aValueNullOrDefault", {
            label: String(label),
          }),
        },
        ...buttons,
      ),
      cast
        ? el(
            doc,
            "label",
            { class: "routine-arg-as desk-muted" },
            messageText("features.routines.fields.as"),
            cast,
          )
        : undefined,
    ),
    editor,
    error,
  );
  row.addEventListener("input", () => hooks.changed());
  // A toggle, a label or an element's button changes the value without an input event.
  editor.addEventListener("click", () => hooks.changed());
  row.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!editor.hidden && view.keys?.(event)) {
      event.preventDefault();
      event.stopPropagation();
      hooks.changed();
      return;
    }
    if (!event.altKey || mod) return;
    const to = offered.find(([, , key]) => key === event.code);
    const tool = view.tools?.find((t) => t.key === event.code);
    if (to) pick(to[0]);
    else if (tool && !editor.hidden) tool.run();
    else return;
    event.preventDefault();
    event.stopPropagation();
    hooks.changed();
  });
  return { el: row, read, focus: () => (editor.hidden ? buttons[0] : view)?.focus() };
}
