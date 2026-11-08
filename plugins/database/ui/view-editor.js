// The SQL editor's DOM: a textarea over a highlighted copy of its text (the same lexer the
// statements are cut with, so a string or a comment is drawn as the client reads it), and an
// autocomplete list at the caret. The list opens by itself after `.` or two letters of a name, or
// on Ctrl+Space; ArrowUp and ArrowDown move in it, Enter or Tab take the choice, Escape closes it.
// The controller answers what to offer (`complete`); this only draws and edits.

import { el } from "./dom.js";
import { highlight } from "./editor/highlight.js";
import { actionFor, pressOf } from "./keys.js";

/**
 * @typedef {import("./sql/lexer.js").Dialect} Dialect
 * @typedef {import("./editor/complete.js").Completion} Completion
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const WORD = /[A-Za-z0-9_$\u0080-￿]/u;
const DELAY = 120;

/**
 * @param {Document} doc
 * @param {{ box: HTMLElement, editor: HTMLTextAreaElement, layer: HTMLElement, list: HTMLElement }} parts
 * @param {Act} act
 * @param {() => boolean} running Whether a run goes on (Escape cancels it then).
 */
export function createEditor(doc, { box, editor, layer, list }, act, running) {
  const win = doc.defaultView;
  const later = (/** @type {() => void} */ fn) =>
    win?.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(fn, 16);
  /** @type {Dialect} */
  let dialect = "postgresql";
  let painting = false;
  /** @type {Completion | null} */
  let open = null;
  let chosen = 0;
  let asking = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  const paint = () => {
    painting = false;
    const runs = highlight(editor.value, dialect).map((run) =>
      run.kind === "plain"
        ? doc.createTextNode(run.text)
        : el(doc, "span", { class: `tok-${run.kind}` }, run.text),
    );
    // A last line break keeps the copy as tall as the textarea when the text ends with one.
    layer.replaceChildren(...runs, doc.createTextNode("\n"));
    sync();
  };
  const schedule = () => {
    if (painting) return;
    painting = true;
    later(paint);
  };
  const sync = () => {
    layer.scrollTop = editor.scrollTop;
    layer.scrollLeft = editor.scrollLeft;
  };

  const close = () => {
    open = null;
    list.hidden = true;
    list.replaceChildren();
    editor.removeAttribute("aria-activedescendant");
    asking++;
  };

  /** Where the caret is, in the box's pixels: a hidden copy of the text up to it (work.css gives
   * it the editor's font and padding). */
  const caretPoint = () => {
    const mirror = el(doc, "div", { class: "mirror", "aria-hidden": "true" });
    mirror.style.width = `${editor.clientWidth}px`;
    mirror.textContent = editor.value.slice(0, editor.selectionStart);
    const mark = el(doc, "span", {}, "​");
    mirror.append(mark);
    box.append(mirror);
    const point = {
      top: mark.offsetTop - editor.scrollTop,
      left: mark.offsetLeft - editor.scrollLeft,
    };
    mirror.remove();
    return point;
  };

  const drawList = () => {
    if (!open) return;
    const items = open.items.map((item, i) =>
      el(
        doc,
        "li",
        {
          id: `complete-${i}`,
          role: "option",
          class: `option kind-${item.kind}`,
          "aria-selected": String(i === chosen),
          "data-index": String(i),
        },
        el(doc, "span", { class: "label" }, item.label),
        el(doc, "span", { class: "detail" }, item.detail),
      ),
    );
    list.replaceChildren(...items);
    const { top, left } = caretPoint();
    list.style.top = `${Math.max(0, top) + 20}px`;
    list.style.left = `${Math.max(0, Math.min(left, editor.clientWidth - 260))}px`;
    list.hidden = false;
    editor.setAttribute("aria-activedescendant", `complete-${chosen}`);
    items[chosen]?.scrollIntoView?.({ block: "nearest" });
  };

  const ask = async (/** @type {boolean} */ asked) => {
    const ticket = ++asking;
    const found = /** @type {Completion | undefined} */ (
      await act("complete", editor.value, editor.selectionStart)
    );
    if (ticket !== asking || doc.activeElement !== editor) return;
    if (!found || found.items.length === 0) {
      close();
      if (asked) act("say", "Nothing to complete here.");
      return;
    }
    open = found;
    chosen = 0;
    drawList();
  };

  const accept = (/** @type {number} */ index) => {
    const item = open?.items[index];
    if (!open || !item) return;
    editor.setRangeText(item.insert, open.from, editor.selectionStart, "end");
    close();
    act("edited", editor.value);
    schedule();
  };

  editor.addEventListener("keydown", (event) => {
    if (open && !event.isComposing) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step) {
        event.preventDefault();
        chosen = (chosen + step + open.items.length) % open.items.length;
        drawList();
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        accept(chosen);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
    }
    if (event.ctrlKey && !event.metaKey && (event.key === " " || event.code === "Space")) {
      event.preventDefault();
      void ask(true);
      return;
    }
    const action = actionFor("editor", pressOf(event), { running: running() });
    if (!action) return;
    event.preventDefault();
    close();
    act(action);
  });
  editor.addEventListener("input", (event) => {
    schedule();
    act("edited", editor.value);
    clearTimeout(timer);
    const typed = /** @type {InputEvent} */ (event).data ?? "";
    const at = editor.selectionStart;
    let from = at;
    while (from > 0 && WORD.test(editor.value[from - 1] ?? "")) from--;
    const wants = typed === "." || (WORD.test(typed) && at - from >= 2);
    if (wants || open) timer = setTimeout(() => void ask(false), DELAY);
    else close();
  });
  editor.addEventListener("scroll", sync);
  editor.addEventListener("blur", () =>
    setTimeout(() => doc.activeElement !== editor && close(), 0),
  );
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[role=option]");
    if (option) accept(Number(/** @type {HTMLElement} */ (option).dataset.index));
  });

  return {
    /** Show text, in a dialect, read-only (DDL) or not; never under the person's typing. */
    show(/** @type {string} */ text, /** @type {Dialect} */ next, /** @type {boolean} */ readOnly) {
      const changed = editor.value !== text || dialect !== next;
      dialect = next;
      editor.readOnly = readOnly;
      if (editor.value !== text) editor.value = text;
      if (changed) schedule();
    },
    /** Replace a range (Format), keeping it undoable where the browser can. */
    replace(/** @type {number} */ start, /** @type {number} */ end, /** @type {string} */ text) {
      editor.focus();
      editor.setSelectionRange(start, end);
      const done = doc.execCommand?.("insertText", false, text);
      if (!done) editor.setRangeText(text, start, end, "end");
      act("edited", editor.value);
      schedule();
    },
    repaint: schedule,
    close,
  };
}
