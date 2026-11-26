// Completion in the console editor through the component's completion hooks: the controller's
// `complete` (features/completion/) answers what to offer, from the statement around the caret only
// (with a DELIMITER line before it when MySQL's delimiter is not `;`), so a 5 MB script costs what its
// statement does. The list opens by itself after `.`, two letters of a name, or INSERT's `(` after
// its table, or on Ctrl+Space; asked for and empty, it says so. It keeps the controller's order and
// filtering. A candidate shows its type or kind beside it and its comment in the info box; one
// with tab stops is inserted as a snippet (Tab and Shift+Tab move between them), one with a range
// replaces that span (`*` written out), and each pick is told to the controller (`picked`). Enter
// while a list shows takes its option, even right after a newer answer replaced it; pressed while
// the list is being asked again, it waits for the answer and takes its first option (a new line
// when nothing is offered).

import { t } from "../strings/index.js";
import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  currentCompletions,
  EditorView,
  insertCompletionText,
  insertNewlineAndIndent,
  keymap,
  Prec,
  pickedCompletion,
  snippet,
} from "../vendor/editor/editor-component.mjs";
import { lexedField } from "./lexing.js";

/**
 * @typedef {import("./complete.js").Completion} Completion
 * @typedef {import("./rank.js").Item} Item
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("../vendor/editor/editor-component.mjs").CompletionContext} Context
 * @typedef {import("../vendor/editor/editor-component.mjs").EditorView} View
 */

const WORD = /[A-Za-z0-9_$\u0080-￿]/u;
/** INSERT INTO a table, its column list just opened. */
const INSERT_LIST = /\binto\s+(?:[\w$]+|"[^"]*")(?:\.(?:[\w$]+|"[^"]*"))?\s*\($/iu;

/** What the controller gets: the statement at `at`, and `at` inside it. */
export function statementWindow(
  /** @type {import("../vendor/editor/editor-component.mjs").EditorState} */ state,
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

/** Whether typing has reached a place the list opens by itself. */
function wanted(/** @type {Context} */ context) {
  const { state, pos } = context;
  const before = state.doc.sliceString(Math.max(0, pos - 160), pos);
  if (before.endsWith(".") || INSERT_LIST.test(before)) return true;
  let n = 0;
  for (let i = before.length - 1; i >= 0 && WORD.test(before[i] ?? ""); i--) n++;
  return n >= 2;
}

/**
 * How a candidate is inserted, telling the controller it was picked.
 * @param {Item} item
 * @param {number} offset where the statement starts in the editor
 * @param {Act} act
 */
export function applyOf(item, offset, act) {
  return (
    /** @type {View} */ view,
    /** @type {unknown} */ completion,
    /** @type {number} */ from,
    /** @type {number} */ to,
  ) => {
    const start = item.range ? item.range.from + offset : from;
    const end = item.range ? Math.max(item.range.to + offset, to) : to;
    if (item.snippet) snippet(item.insert)(view, completion, start, end);
    else
      view.dispatch({
        ...insertCompletionText(view.state, item.insert, start, end),
        ...(completion ? { annotations: pickedCompletion.of(completion) } : {}),
      });
    act("picked", item.key);
  };
}

/** A candidate as the component lists it. */
export const optionOf = (
  /** @type {Item} */ item,
  /** @type {number} */ offset,
  /** @type {Act} */ act,
) => ({
  label: item.label,
  detail: item.detail,
  ...(item.info ? { info: item.info } : {}),
  type: item.kind,
  apply: applyOf(item, offset, act),
});

/**
 * Write out the `*` at the caret as its columns; false when there is none to write out.
 * @param {View} view
 * @param {Act} act
 */
export async function expandStar(view, act) {
  const at = view.state.selection.main.head;
  const doc = view.state.doc;
  const { text, caret, offset } = statementWindow(view.state, at);
  const found = /** @type {Completion | undefined} */ (
    await act("complete", text, caret, offset, "star")
  );
  const item = found?.items[0];
  if (!item || view.state.doc !== doc) return false;
  applyOf(item, offset, act)(view, null, found.from + offset, found.to + offset);
  return true;
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
    const found = /** @type {Completion | undefined} */ (
      await act("complete", text, caret, offset)
    );
    if (context.aborted) return null;
    if (!found || found.items.length === 0) {
      if (context.explicit) act("say", t("editor.completion.nothingToCompleteHere"));
      return null;
    }
    return {
      from: found.from + offset,
      to: found.to + offset,
      filter: false,
      options: found.items.map((item) => optionOf(item, offset, act)),
    };
  };
  // Whether a list showed in this completion session, and an Enter that waits for the answer.
  let shown = false;
  let waiting = false;
  /** @param {View} view */
  const enter = (view) => {
    if (acceptCompletion(view)) return true;
    if (!shown || completionStatus(view.state) !== "pending") return false;
    waiting = true;
    return true;
  };
  const follow = EditorView.updateListener.of((update) => {
    const status = completionStatus(update.state);
    const typed = update.transactions.some((tr) => tr.isUserEvent("input"));
    if (waiting && typed && update.docChanged) waiting = false;
    if (status === "active" && currentCompletions(update.state).length > 0) shown = true;
    if (status === "pending" || status === "active") {
      if (waiting && status === "active") {
        waiting = false;
        setTimeout(() => acceptCompletion(update.view) || insertNewlineAndIndent(update.view));
      }
      return;
    }
    shown = false;
    if (waiting) {
      waiting = false;
      setTimeout(() => insertNewlineAndIndent(update.view));
    }
  });
  return [
    autocompletion({
      override: [source],
      icons: false,
      activateOnTypingDelay: 120,
      // Enter and Tab take the option shown even right after the list was replaced by a newer
      // answer; the component's default (75 ms) let Enter fall through to a new line then.
      interactionDelay: 0,
      optionClass: (option) => `option kind-${option.type ?? "keyword"}`,
      closeOnBlur: true,
      maxRenderedOptions: 100,
      // Its keys are in the editor's keymap (keymap.js), after the surface's.
      defaultKeymap: false,
    }),
    Prec.high(keymap.of([{ key: "Enter", run: enter }])),
    follow,
  ];
}
