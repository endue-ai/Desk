// A code editor without a library: a textarea laid exactly over a highlighted copy of its text,
// with line numbers beside them. Tab indents, Enter keeps the line's indent (one more after an
// opening bracket), a closing bracket typed on a blank indent steps back, and Mod+/ comments a
// line in JavaScript. {{variables}} are marked as in every other field.

import { h } from "./dom.js";
import { paint, runs, withVars } from "./highlight.js";

/**
 * @typedef {{ value: string, lang: string, placeholder?: string, readOnly?: boolean,
 *   scopes?: () => import("./vars.js").Scope[], onChange?(value: string): void, minLines?: number,
 *   label?: string }} EditorSpec
 */

const PAIRS = /** @type {Record<string, string>} */ ({ "{": "}", "[": "]", "(": ")" });

/** @param {EditorSpec} spec */
export function codeEditor(spec) {
  let lang = spec.lang;
  const gutter = h("div.ce-gutter", { "aria-hidden": "true" });
  const hl = h("pre.ce-hl", { "aria-hidden": "true" });
  const area = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.ce-input", {
      // ds: own — the editor draws the body's own text
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      "aria-label": spec.label ?? "Editor",
      placeholder: spec.placeholder ?? "",
      readOnly: spec.readOnly ? true : undefined,
      wrap: "off",
    })
  );
  area.value = spec.value;
  const layer = h("div.ce-layer", null, hl, area);
  const scroller = h("div.ce-scroll", null, layer);
  const root = h("div.ce", { dataset: { lang } }, gutter, scroller);

  const draw = () => {
    const text = area.value;
    const list = runs(text, lang);
    paint(hl, spec.scopes ? withVars(list, spec.scopes()) : list);
    // A trailing newline needs a character after it to take up its line.
    if (text.endsWith("\n") || text === "") hl.append(document.createTextNode(" "));
    const count = Math.max(spec.minLines ?? 1, text.split("\n").length);
    if (gutter.childElementCount !== count) {
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= count; i++) frag.append(h("div", null, String(i)));
      gutter.replaceChildren(frag);
    }
    root.classList.toggle("is-empty", text === "");
  };
  scroller.addEventListener("scroll", () => {
    gutter.scrollTop = scroller.scrollTop;
  });

  const edit = (
    /** @type {string} */ insert,
    /** @type {number} */ from,
    /** @type {number} */ to,
    caret = from + insert.length,
  ) => {
    area.setRangeText(insert, from, to, "end");
    area.setSelectionRange(caret, caret);
    changed();
  };
  const changed = () => {
    draw();
    spec.onChange?.(area.value);
  };
  area.addEventListener("input", changed);
  area.addEventListener("keydown", (event) => {
    if (spec.readOnly) return;
    const { selectionStart: s, selectionEnd: e, value } = area;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const indent = /^[ \t]*/.exec(value.slice(lineStart))?.[0] ?? "";
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (s === e && !event.shiftKey) return edit("  ", s, e);
      // Indent or outdent every selected line.
      const start = lineStart;
      const block = value.slice(start, e);
      const next = event.shiftKey ? block.replace(/^ {1,2}/gm, "") : block.replace(/^/gm, "  ");
      area.setRangeText(next, start, e, "select");
      changed();
    } else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const before = value[s - 1] ?? "";
      const after = value[s] ?? "";
      const close = PAIRS[before];
      if (close) {
        const inner = `\n${indent}  `;
        if (after === close) return edit(`${inner}\n${indent}`, s, e, s + inner.length);
        return edit(inner, s, e);
      }
      edit(`\n${indent}`, s, e);
    } else if ("}])".includes(event.key) && s === e && /^[ \t]+$/.test(value.slice(lineStart, s))) {
      event.preventDefault();
      edit(event.key, Math.max(lineStart, s - 2), s);
    } else if (event.key === "/" && (event.metaKey || event.ctrlKey) && lang === "js") {
      event.preventDefault();
      const end = value.indexOf("\n", e);
      const block = value.slice(lineStart, end < 0 ? value.length : end);
      const commented = /^\s*\/\/ ?/.test(block);
      const next = commented
        ? block.replace(/^(\s*)\/\/ ?/gm, "$1")
        : block.replace(/^(\s*)/gm, "$1// ");
      area.setRangeText(next, lineStart, end < 0 ? value.length : end, "select");
      changed();
    }
  });
  draw();

  return {
    el: root,
    area,
    get value() {
      return area.value;
    },
    /** Replace the text (from a format, a template or another tab). @param {string} text */
    set(text) {
      if (area.value !== text) area.value = text;
      draw();
    },
    /** @param {string} next */
    setLang(next) {
      lang = next;
      root.dataset.lang = next;
      draw();
    },
    redraw: draw,
    focus: () => area.focus(),
  };
}
