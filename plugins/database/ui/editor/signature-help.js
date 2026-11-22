// Signature help in the console editor (ADR 0327): inside a call, the function's overloads in a
// tooltip above the `(`, the argument at the caret in bold, with its comment. It opens on typing
// `(` after a function's name or `,` inside a call, and on Ctrl+Shift+Space; it follows the caret
// through the call and closes when the caret leaves it, on `)` that ends it, or on Escape. While it
// shows and the completion list is closed, ArrowUp and ArrowDown step through the overloads. The
// controller's `complete` (with "signature") says what to show; nothing is asked of the server.

import {
  completionStatus,
  EditorView,
  keymap,
  Prec,
  StateEffect,
  StateField,
  showTooltip,
} from "../vendor/editor/editor-component.mjs";
import { statementWindow } from "./completion.js";

/**
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("../vendor/editor/editor-component.mjs").EditorView} View
 * @typedef {import("./signatures.js").Signature} Signature
 * @typedef {{ pos: number, signature: Signature, index: number }} Shown
 */

const set = StateEffect.define();

const field = StateField.define({
  create: () => /** @type {Shown | null} */ (null),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(set)) return /** @type {Shown | null} */ (e.value);
    if (!value) return value;
    const pos = tr.changes.mapPos(value.pos);
    if (tr.state.selection.main.head <= pos) return null;
    return pos === value.pos ? value : { ...value, pos };
  },
  provide: (f) =>
    showTooltip.from(f, (shown) =>
      shown
        ? { pos: shown.pos, above: true, create: (view) => ({ dom: render(view, shown) }) }
        : null,
    ),
});

/** The tooltip: the overload shown, the argument at the caret in bold, which of how many, its comment. */
function render(/** @type {View} */ view, /** @type {Shown} */ shown) {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div");
  dom.className = "signature-help";
  dom.setAttribute("role", "status");
  dom.setAttribute("aria-live", "polite");
  const { signature, index } = shown;
  const overload = signature.overloads[index];
  if (!overload) return dom;
  const line = doc.createElement("div");
  line.className = "signature";
  line.append(`${signature.name}(`);
  for (const [i, arg] of overload.args.entries()) {
    if (i > 0) line.append(", ");
    const last = i === overload.args.length - 1 && /^variadic\s/iu.test(arg);
    const active = i === signature.arg || (last && signature.arg > i);
    if (!active) {
      line.append(arg);
      continue;
    }
    const strong = doc.createElement("strong");
    strong.className = "signature-arg";
    strong.textContent = arg;
    line.append(strong);
  }
  line.append(`)${overload.result ? ` → ${overload.result}` : ""}`);
  dom.append(line);
  if (signature.overloads.length > 1) {
    const count = doc.createElement("div");
    count.className = "signature-count";
    count.textContent = `${index + 1} of ${signature.overloads.length}, ArrowUp and ArrowDown for the others`;
    dom.append(count);
  }
  if (overload.comment) {
    const note = doc.createElement("div");
    note.className = "signature-comment";
    note.textContent = overload.comment;
    dom.append(note);
  }
  return dom;
}

/**
 * The extension and the command that asks for the help.
 * @param {Act} act
 */
export function signatureHelp(act) {
  /** Ask for the help at the caret; false when the caret is in no call. */
  const ask = async (/** @type {View} */ view) => {
    const doc = view.state.doc;
    const head = view.state.selection.main.head;
    const { text, caret, offset } = statementWindow(view.state, head);
    const found = /** @type {{ signature?: Signature | null } | undefined} */ (
      await act("complete", text, caret, offset, "signature")
    );
    if (view.state.doc !== doc || view.state.selection.main.head !== head) return false;
    const signature = found?.signature ?? null;
    const before = view.state.field(field);
    const value = signature
      ? {
          pos: signature.at + offset,
          signature,
          index:
            before && before.signature.name === signature.name ? before.index : signature.active,
        }
      : null;
    if (value || before) view.dispatch({ effects: set.of(value) });
    return Boolean(signature);
  };
  const step = (/** @type {number} */ by) => (/** @type {View} */ view) => {
    const shown = view.state.field(field);
    if (!shown || completionStatus(view.state) === "active") return false;
    const n = shown.signature.overloads.length;
    if (n < 2) return false;
    view.dispatch({ effects: set.of({ ...shown, index: (shown.index + by + n) % n }) });
    return true;
  };
  const extension = [
    field,
    Prec.high(
      keymap.of([
        {
          key: "Ctrl-Shift-Space",
          run: (view) => {
            void ask(view);
            return true;
          },
        },
        { key: "ArrowDown", run: step(1) },
        { key: "ArrowUp", run: step(-1) },
        {
          key: "Escape",
          run: (view) => {
            if (!view.state.field(field) || completionStatus(view.state) === "active") return false;
            view.dispatch({ effects: set.of(null) });
            return true;
          },
        },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      const shown = update.state.field(field);
      if (!update.docChanged) {
        if (shown && update.selectionSet) void ask(update.view);
        return;
      }
      let typed = "";
      for (const tr of update.transactions)
        if (tr.isUserEvent("input.type"))
          tr.changes.iterChanges((_a, _b, _c, _d, text) => {
            typed += text.toString();
          });
      if (/[(,]/u.test(typed) || (shown && (typed !== "" || update.selectionSet)))
        void ask(update.view);
    }),
  ];
  return { extension, ask };
}
