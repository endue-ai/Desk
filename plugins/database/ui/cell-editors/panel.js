// The frame every typed cell editor opens in (PG-40): a popover at its cell with the column's name
// and type (and the session's time zone for one that keeps a zone), the kind's own controls, the
// reason a value is refused, and its choices: Set NULL where the column allows it, Set DEFAULT where
// it has one, the kind's tools, Keep. Enter keeps (Mod+Enter where Enter makes a new line), Escape
// cancels, Alt+N and Alt+D choose NULL and DEFAULT, Tab stays inside; a press outside keeps what
// checks. `field` is the text field most kinds are made of.

import { el } from "../dom.js";
import { DEFAULT, isDefault } from "../edit/values.js";
import { t as messageText } from "../strings/index.js";

/**
 * @typedef {import("./resolve.js").Editor} Editor
 * @typedef {{ value: string | null } | { error: string }} Checked
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {{ label: string, name: string, key?: string, run(): unknown }} Tool
 *   `key` is the KeyboardEvent.code that runs it with Alt (KeyG for Alt+G).
 * @typedef {{
 *   el: HTMLElement, read(): Checked, focus(): void, multiline?: boolean,
 *   keys?(event: KeyboardEvent): boolean, tools?: Tool[],
 * }} View
 *   `keys` takes a key the kind handles itself (true: handled).
 * @typedef {{
 *   doc: Document, editor: Editor, value: string | null, name: string, act: Act,
 *   keep(): void, fail(why: string): void, clear(): void,
 * }} Ctx
 *   `value` is the cell's value as it is (DEFAULT a pending one); `keep` keeps what the view reads.
 * @typedef {{
 *   act: Act, finish(value: string | null, how: "down" | "none"): void, cancel(): void,
 * }} Hooks
 */

const FOCUSABLE = "button:not([hidden]), input, textarea, [tabindex='0']";

/**
 * @param {Document} doc
 * @param {HTMLElement} host Where the popover is put (the grid).
 * @param {HTMLElement} anchor The cell it opens at.
 * @param {{ value: string | null, name: string, editor: Editor }} opened
 * @param {(ctx: Ctx) => View} make
 * @param {Hooks} hooks
 */
export function openPanel(doc, host, anchor, opened, make, hooks) {
  const { editor, name } = opened;
  const error = el(doc, "p", {
    class: "desk-error cell-editor-error",
    role: "alert",
    hidden: true,
  });
  const fail = (/** @type {string} */ why) => {
    error.textContent = why;
    error.hidden = false;
  };
  const clear = () => {
    error.hidden = true;
    error.textContent = "";
  };
  let closed = false;
  const close = () => {
    if (closed) return false;
    closed = true;
    root.remove();
    doc.removeEventListener("pointerdown", outside, true);
    return true;
  };
  const choose = (/** @type {string | null} */ value, /** @type {"down" | "none"} */ how) => {
    if (close()) hooks.finish(value, how);
  };
  const keep = (/** @type {"down" | "none"} */ how) => {
    const read = view.read();
    if ("error" in read) fail(read.error);
    else choose(read.value, how);
  };
  const cancel = () => {
    if (close()) hooks.cancel();
  };
  /** @type {Ctx} */
  const ctx = {
    doc,
    editor,
    value: opened.value,
    name,
    act: hooks.act,
    keep: () => keep("down"),
    fail,
    clear,
  };
  const view = make(ctx);
  const nullable = editor.nullable && editor.kind !== "boolean";
  const button = (/** @type {Record<string, string>} */ attrs, /** @type {string} */ label) =>
    el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet", ...attrs }, label);
  const tools = (view.tools ?? []).map((tool) => {
    const b = button(
      {
        "data-do": tool.name,
        title: tool.key
          ? messageText("cellEditors.panel.alt", { value: String(tool.key.slice(3)) })
          : "",
      },
      tool.label,
    );
    b.addEventListener("click", () => tool.run());
    return b;
  });
  const setNull = nullable
    ? button({ "data-choice": "null", title: messageText("cellEditors.panel.altN") }, "Set NULL")
    : undefined;
  const setDefault = editor.hasDefault
    ? button(
        { "data-choice": "default", title: messageText("cellEditors.panel.altD") },
        "Set DEFAULT",
      )
    : undefined;
  setNull?.addEventListener("click", () => choose(null, "none"));
  setDefault?.addEventListener("click", () => choose(DEFAULT, "none"));
  const keepButton = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-primary", "data-do": "keep" },
    messageText("cellEditors.panel.keep"),
  );
  keepButton.addEventListener("click", () => keep("none"));
  const hint = [
    view.multiline ? "Mod+Enter keeps" : "Enter keeps",
    "Escape cancels",
    nullable ? "Alt+N NULL" : "",
    editor.hasDefault ? "Alt+D DEFAULT" : "",
  ].filter(Boolean);
  const root = el(
    doc,
    "div",
    {
      class: `cell-editor cell-editor-${editor.kind}`,
      role: "dialog",
      "aria-label": messageText("cellEditors.panel.change", { name: String(name) }),
    },
    el(
      doc,
      "div",
      { class: "cell-editor-head" },
      el(doc, "strong", {}, name),
      el(
        doc,
        "span",
        { class: "desk-muted" },
        editor.kind === "enum" && !/^enum\b/iu.test(editor.type)
          ? messageText("cellEditors.panel.enum", { type: String(editor.type) })
          : editor.type,
      ),
      editor.zone && editor.timeZone
        ? el(
            doc,
            "span",
            { class: "desk-muted" },
            messageText("cellEditors.panel.timeZone", { timeZone: String(editor.timeZone) }),
          )
        : undefined,
    ),
    view.el,
    error,
    el(
      doc,
      "div",
      { class: "cell-editor-foot" },
      ...tools,
      setNull,
      setDefault,
      el(doc, "span", { class: "cell-editor-spacer" }),
      keepButton,
    ),
    el(doc, "p", { class: "cell-editor-hint desk-muted" }, hint.join(" · ")),
  );

  root.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    event.stopPropagation();
    if (view.keys?.(event)) return event.preventDefault();
    const mod = event.metaKey || event.ctrlKey;
    const onButton = /** @type {HTMLElement} */ (event.target).tagName === "BUTTON";
    let handled = true;
    if (event.key === "Escape") cancel();
    else if (event.key === "Enter" && !event.altKey && !onButton && (mod || !view.multiline))
      keep("down");
    else if (event.altKey && !mod && event.code === "KeyN" && nullable) choose(null, "down");
    else if (event.altKey && !mod && event.code === "KeyD" && editor.hasDefault)
      choose(DEFAULT, "down");
    else if (event.altKey && !mod && view.tools?.some((t) => t.key === event.code))
      view.tools.find((t) => t.key === event.code)?.run();
    else if (event.key === "Tab") handled = trap(event);
    else handled = false;
    if (handled) event.preventDefault();
  });
  /** Tab goes round the popover's controls. */
  const trap = (/** @type {KeyboardEvent} */ event) => {
    const all = [...root.querySelectorAll(FOCUSABLE)].filter(
      (n) => !(/** @type {HTMLElement} */ (n).hidden),
    );
    const [first, last] = [all[0], all.at(-1)];
    const at = doc.activeElement;
    if (event.shiftKey && at === first) /** @type {HTMLElement} */ (last)?.focus();
    else if (!event.shiftKey && at === last) /** @type {HTMLElement} */ (first)?.focus();
    else return false;
    return true;
  };
  /** A press outside keeps what checks; what does not is dropped, and said. */
  const outside = (/** @type {Event} */ event) => {
    if (root.contains(/** @type {Node} */ (event.target))) return;
    const read = view.read();
    if ("error" in read) {
      cancel();
      hooks.act("say", `Not kept: ${read.error}`);
    } else choose(read.value, "none");
  };
  doc.addEventListener("pointerdown", outside, true);
  host.append(root);
  place(doc, root, anchor);
  view.focus();
  return { close: cancel };
}

/** Put the popover under its cell, or over it when there is no room below, inside the page. */
function place(
  /** @type {Document} */ doc,
  /** @type {HTMLElement} */ root,
  /** @type {HTMLElement} */ anchor,
) {
  const win = doc.defaultView;
  const box = anchor.getBoundingClientRect();
  const [vw, vh] = [win?.innerWidth ?? 0, win?.innerHeight ?? 0];
  const [width, height] = [root.offsetWidth, root.offsetHeight];
  let top = box.bottom + 2;
  if (top + height > vh - 8) top = box.top - height - 2;
  top = Math.max(8, Math.min(top, vh - height - 8));
  const left = Math.max(8, Math.min(box.left, vw - width - 8));
  root.style.top = `${top}px`;
  root.style.left = `${left}px`;
  root.style.minWidth = `${Math.round(box.width)}px`;
}

/** A cell's value as the text a field starts with: none for NULL and DEFAULT. */
export const textOf = (/** @type {string | null} */ value) =>
  value === null || isDefault(value) ? "" : value;

/**
 * The text field most kinds are: empty keeps NULL or DEFAULT as they were, else `check` reads it.
 * @param {Ctx} ctx
 * @param {{ text?: string, check(text: string): Checked, multiline?: boolean, example?: string }} options
 */
export function field(ctx, { text = textOf(ctx.value), check, multiline = false, example = "" }) {
  const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (
    el(ctx.doc, multiline ? "textarea" : "input", {
      class: "desk-field cell-editor-text",
      spellcheck: "false",
      "aria-label": messageText("cellEditors.panel.sValue", { name: String(ctx.name) }),
      ...(multiline ? { rows: "8" } : {}),
    })
  );
  input.value = text;
  input.placeholder =
    ctx.value === null
      ? messageText("cellEditors.panel.null")
      : isDefault(ctx.value)
        ? messageText("cellEditors.panel.default")
        : example;
  input.addEventListener("input", () => ctx.clear());
  /** @returns {Checked} */
  const read = () =>
    input.value === "" && (ctx.value === null || isDefault(ctx.value))
      ? { value: ctx.value }
      : check(input.value);
  return {
    input,
    read,
    focus() {
      input.focus();
      if (!multiline) input.select();
    },
  };
}
