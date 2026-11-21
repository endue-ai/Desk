// The console editor's keys. The surface's own come first (keys.js: Mod+Enter runs the statement,
// Mod+Shift+Enter the script, Mod+Shift+F formats, Escape cancels only while a run goes on), and
// never while an IME composes. Then the editor's: completion, find and replace, several carets,
// comments, indentation, folding, history and the usual movement. Chords the desk binds (Mod+D,
// Mod+/, Mod+[, Mod+], Mod+Shift+L, Mod+Alt+G …) are left to the desk: selecting the next
// occurrence is Alt+J, a line comment Mod+Alt+/, indenting Tab with a selection (Tab without one
// leaves the editor, as it did).

import { actionFor, pressOf } from "../keys.js";
import {
  acceptCompletion,
  addCursorAbove,
  addCursorBelow,
  closeCompletion,
  completionKeymap,
  completionStatus,
  copyLineDown,
  copyLineUp,
  deleteLine,
  EditorView,
  findNext,
  findPrevious,
  foldKeymap,
  historyKeymap,
  indentLess,
  indentMore,
  keymap,
  moveLineDown,
  moveLineUp,
  openSearchPanel,
  Prec,
  searchKeymap,
  selectLine,
  selectNextOccurrence,
  selectSelectionMatches,
  simplifySelection,
  standardKeymap,
  toggleBlockComment,
  toggleComment,
} from "../vendor/editor/editor-component.mjs";
import { toMatching } from "./lexing.js";

/**
 * @typedef {import("../vendor/editor/editor-component.mjs").EditorView} View
 * @typedef {(view: View) => boolean} Command
 */

/** Tab and Shift+Tab indent only a selection; with none they leave the editor. */
const withSelection = (/** @type {Command} */ command) => (/** @type {View} */ view) =>
  view.state.selection.ranges.some((r) => !r.empty) && command(view);

/** Bindings of the editor's own, after the surface's. */
export const editorKeys = [
  { key: "Tab", run: acceptCompletion },
  { key: "Tab", run: withSelection(indentMore), shift: withSelection(indentLess) },
  ...completionKeymap,
  { key: "Mod-f", run: openSearchPanel, scope: "editor search-panel" },
  {
    key: "F3",
    run: findNext,
    shift: findPrevious,
    scope: "editor search-panel",
    preventDefault: true,
  },
  {
    key: "Mod-g",
    run: findNext,
    shift: findPrevious,
    scope: "editor search-panel",
    preventDefault: true,
  },
  { key: "Alt-j", run: selectNextOccurrence, shift: selectSelectionMatches, preventDefault: true },
  { key: "Mod-Alt-ArrowUp", run: addCursorAbove },
  { key: "Mod-Alt-ArrowDown", run: addCursorBelow },
  { key: "Alt-ArrowUp", run: moveLineUp, shift: copyLineUp },
  { key: "Alt-ArrowDown", run: moveLineDown, shift: copyLineDown },
  { key: "Mod-Alt-/", run: toggleComment },
  { key: "Shift-Alt-a", run: toggleBlockComment },
  { key: "Shift-Mod-k", run: deleteLine },
  { key: "Shift-Mod-\\", run: toMatching },
  { key: "Alt-l", mac: "Ctrl-l", run: selectLine },
  ...searchKeymap.filter((b) => b.key === "Escape"),
  { key: "Escape", run: simplifySelection },
  ...foldKeymap,
  ...historyKeymap,
  ...standardKeymap,
];

/**
 * The surface's keys, ahead of everything else in the editor.
 * @param {(action: string) => void} act
 * @param {() => boolean} running
 */
export function surfaceKeys(act, running) {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        // A key that ends or steers a composition is the IME's, never a run.
        if (event.isComposing || view.composing || event.keyCode === 229) return false;
        const open = completionStatus(view.state) === "active";
        if (open && !event.metaKey && !event.ctrlKey) return false;
        const action = actionFor("editor", pressOf(event), { running: running() });
        if (!action) return false;
        event.preventDefault();
        closeCompletion(view);
        act(action);
        return true;
      },
    }),
  );
}

/** Every key of the editor: the surface's, then the editor's own. */
export const editorKeymap = (
  /** @type {(action: string) => void} */ act,
  /** @type {() => boolean} */ running,
) => [surfaceKeys(act, running), keymap.of(editorKeys)];
