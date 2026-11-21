// Completion in the console editor through the component's completion hooks: the controller's
// `complete` (complete.js) answers what to offer, from the statement around the caret only (with
// a DELIMITER line before it when MySQL's delimiter is not `;`), so a 5 MB script costs what its
// statement does. The list opens by itself after `.` or two letters of a name, or on Ctrl+Space;
// asked for and empty, it says so. It keeps the controller's order and filtering.

import { autocompletion } from "../vendor/editor-component.mjs";
import { lexedField } from "./lexing.js";

/**
 * @typedef {import("./complete.js").Completion} Completion
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("../vendor/editor-component.mjs").CompletionContext} Context
 */

const WORD = /[A-Za-z0-9_$\u0080-￿]/u;

/** What the controller gets: the statement at `at`, and `at` inside it. */
export function statementWindow(
  /** @type {import("../vendor/editor-component.mjs").EditorState} */ state,
  /** @type {number} */ at,
) {
  const lexed = state.field(lexedField);
  const { from, to, delimiter } = lexed.statementAt(at);
  const prefix = lexed.dialect === "mysql" && delimiter !== ";" ? `DELIMITER ${delimiter}\n` : "";
  return {
    text: prefix + state.doc.sliceString(from, to),
    caret: at - from + prefix.length,
    offset: from - prefix.length,
  };
}

/** Whether typing has reached a place the list opens by itself: after `.` or two letters. */
function wanted(/** @type {Context} */ context) {
  const { state, pos } = context;
  const before = state.doc.sliceString(Math.max(0, pos - 64), pos);
  if (before.endsWith(".")) return true;
  let n = 0;
  for (let i = before.length - 1; i >= 0 && WORD.test(before[i] ?? ""); i--) n++;
  return n >= 2;
}

/**
 * The completion extension.
 * @param {Act} act
 */
export function sqlCompletion(act) {
  /** @param {Context} context */
  const source = async (context) => {
    if (!context.explicit && !wanted(context)) return null;
    const { text, caret, offset } = statementWindow(context.state, context.pos);
    const found = /** @type {Completion | undefined} */ (await act("complete", text, caret));
    if (context.aborted) return null;
    if (!found || found.items.length === 0) {
      if (context.explicit) act("say", "Nothing to complete here.");
      return null;
    }
    return {
      from: found.from + offset,
      to: found.to + offset,
      filter: false,
      options: found.items.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: item.kind,
        apply: item.insert,
      })),
    };
  };
  return autocompletion({
    override: [source],
    icons: false,
    activateOnTypingDelay: 120,
    optionClass: (option) => `option kind-${option.type ?? "keyword"}`,
    closeOnBlur: true,
    maxRenderedOptions: 100,
    // Its keys are in the editor's keymap (keymap.js), after the surface's.
    defaultKeymap: false,
  });
}
