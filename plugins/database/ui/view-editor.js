// The SQL editor: the vendored editor component (ADR 0282) in the console's box, with the plugin's
// own lexer for highlighting, brackets, quotes and folds (editor/lexing.js), completion from the
// controller (editor/completion.js) with a call's signature help (editor/signature-help.js), find and replace (editor/search-panel.js), several carets and
// column selection (Alt+drag), comment and indent toggles, and an undo history per console: each
// console's editor state (text, history, selection, folds, scroll) is kept while the plugin runs.
// F12, Shift+F12, Alt+F12 and a resting pointer go from a name to what it means (navigate/editor.js).
// The console's textarea stays the handle the surface holds (editor/facade.js). The controller
// answers what to offer and runs; this only draws and edits. SQL problems are diagnose/'s.

import { sqlProblems } from "./diagnose/editor.js";
import { expandStar, sqlCompletion } from "./editor/completion.js";
import { attachFacade, textOf } from "./editor/facade.js";
import { editorKeymap } from "./editor/keymap.js";
import { dialectFacet, sqlLanguage } from "./editor/lexing.js";
import { findAndReplace } from "./editor/search-panel.js";
import { signatureHelp } from "./editor/signature-help.js";
import { navigation } from "./navigate/editor.js";
import { t } from "./strings/index.js";
import {
  Annotation,
  Compartment,
  closeCompletion,
  codeFolding,
  crosshairCursor,
  drawSelection,
  EditorState,
  EditorView,
  foldGutter,
  highlightSelectionMatches,
  history,
  indentUnit,
  placeholder,
  rectangularSelection,
} from "./vendor/editor/editor-component.mjs";

/**
 * @typedef {import("./sql/lexer.js").Dialect} Dialect
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("./vendor/editor/editor-component.mjs").EditorState} State
 */

/** How many consoles keep their editor state at once; the oldest goes first. */
export const KEPT = 32;

/** A change that comes from the console's model (another console, the history), not the person. */
const fromModel = Annotation.define();

/** The change from `before` to `after`: only what differs between their common start and end. */
export function diff(/** @type {string} */ before, /** @type {string} */ after) {
  const n = Math.min(before.length, after.length);
  let start = 0;
  while (start < n && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < n - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  )
    end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/**
 * @param {Document} doc
 * @param {{ box: HTMLElement, editor: HTMLTextAreaElement, layer: HTMLElement, list: HTMLElement }} parts
 * @param {Act} act
 * @param {() => boolean} running Whether a run goes on (Escape cancels it then).
 */
export function createEditor(doc, { box, editor, layer, list }, act, running) {
  const dialect = new Compartment();
  const readOnly = new Compartment();
  const problems = sqlProblems(act);
  const signatures = signatureHelp(act);
  const navigate = navigation(act);
  const fixed = [
    sqlLanguage,
    history(),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    EditorState.allowMultipleSelections.of(true),
    highlightSelectionMatches(),
    codeFolding({ placeholderText: "…" }),
    foldGutter({ markerDOM: (open) => marker(doc, open) }),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    indentUnit.of("  "),
    EditorState.languageData.of(() => [
      { commentTokens: { line: "--", block: { open: "/*", close: "*/" } } },
    ]),
    placeholder(editor.placeholder),
    EditorView.contentAttributes.of({
      "aria-label": editor.getAttribute("aria-label") ?? t("viewEditor.sql"),
      "aria-multiline": "true",
    }),
    findAndReplace(),
    sqlCompletion(act),
    signatures.extension,
    problems.extension,
    navigate.extension,
    editorKeymap((action) => act(action), running),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.every((tr) => tr.annotation(fromModel))) return;
      act("edited", textOf(update.state.doc));
    }),
  ];
  const readOnlyOf = (/** @type {boolean} */ on) => [
    EditorState.readOnly.of(on),
    EditorView.contentAttributes.of({ "aria-readonly": String(on) }),
  ];
  const stateOf = (/** @type {string} */ text, /** @type {Dialect} */ next, on = false) =>
    EditorState.create({
      doc: text,
      extensions: [dialect.of(dialectFacet.of(next)), readOnly.of(readOnlyOf(on)), fixed],
    });

  const view = new EditorView({ state: stateOf("", "postgresql"), parent: box });
  const editorShown = () => !box.hidden && !view.state.readOnly;
  layer.hidden = true;
  list.hidden = true;
  attachFacade(editor, view, {
    setReadOnly: (on) => view.dispatch({ effects: readOnly.reconfigure(readOnlyOf(on)) }),
  });

  /** @type {Map<unknown, { state: State, scroll: unknown }>} */
  const kept = new Map();
  /** @type {unknown} */
  let shownKey;

  /** Show the console `key`: its kept state, or a new one with `text`. */
  const switchTo = (
    /** @type {unknown} */ key,
    /** @type {string} */ text,
    /** @type {Dialect} */ next,
    /** @type {boolean} */ on,
  ) => {
    if (shownKey !== undefined) {
      kept.delete(shownKey);
      kept.set(shownKey, { state: view.state, scroll: view.scrollSnapshot() });
      while (kept.size > KEPT) kept.delete(kept.keys().next().value);
    }
    shownKey = key;
    const entry = kept.get(key);
    view.setState(entry ? entry.state : stateOf(text, next, on));
    if (entry) view.dispatch({ effects: /** @type {never} */ (entry.scroll) });
  };

  return {
    /** Show text, in a dialect, read-only (DDL) or not, for the console `key`; never under the
     * person's typing: the text the controller has from this editor changes nothing. */
    show(
      /** @type {string} */ text,
      /** @type {Dialect} */ next,
      /** @type {boolean} */ on,
      /** @type {unknown} */ key = shownKey ?? "",
    ) {
      if (key !== shownKey) switchTo(key, text, next, on);
      const state = view.state;
      const effects = [];
      if (state.facet(dialectFacet) !== next)
        effects.push(dialect.reconfigure(dialectFacet.of(next)));
      if (state.readOnly !== on) effects.push(readOnly.reconfigure(readOnlyOf(on)));
      const current = textOf(state.doc);
      const changes = current === text ? undefined : diff(current, text);
      if (!changes && effects.length === 0) return;
      view.dispatch({ changes, effects, annotations: fromModel.of(true) });
    },
    /** Replace a range (Format), undoable. */
    replace(/** @type {number} */ start, /** @type {number} */ end, /** @type {string} */ text) {
      view.focus();
      view.dispatch({
        changes: { from: start, to: end, insert: text },
        selection: { anchor: start + text.length },
        scrollIntoView: true,
        userEvent: "input.format",
      });
    },
    repaint: () => view.requestMeasure(),
    close: () => closeCompletion(view),
    /** Show the arguments of the call at the caret; false when it is in none. */
    signatures: () => (editorShown() ? signatures.ask(view) : false),
    /** Write out the `*` at the caret as its columns; false when there is none. */
    expandStar: () => (editorShown() ? expandStar(view, act) : false),
    /** Go to the definition of the name at the caret, show its card or find its usages. */
    navigate: (/** @type {import("./navigate/controller.js").What} */ what) =>
      box.hidden ? false : navigate.run(view, what),
    /** Step through the SQL problems or list them; false when this editor has none to check. */
    problems: (/** @type {"list" | "next" | "previous"} */ what) => problems.step(view, what),
    /** What the problems are checked against may have changed (the schema cache, a setting). */
    recheck: () => problems.recheck(view),
    /** A run of the console shown: the server's answers win over the check. */
    ran: (/** @type {import("./execute.js").Execution} */ execution) =>
      problems.ran(view, String(shownKey ?? ""), execution),
  };
}

/** The fold gutter's marker: a chevron, open or closed, from the theme's text colour. */
function marker(/** @type {Document} */ doc, /** @type {boolean} */ open) {
  const span = doc.createElement("span");
  span.className = `fold-marker ${open ? "open" : "closed"}`;
  span.textContent = open ? "⌄" : "›";
  span.setAttribute("aria-hidden", "true");
  return span;
}
