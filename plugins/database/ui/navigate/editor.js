// Navigation in the console editor (PG-32): F12 goes to the definition of the name at the caret (the
// caret moves to a CTE, an alias or an output name the statement defines; an object's DDL opens),
// Shift+F12 lists its usages, Alt+F12 shows its card at the caret until the caret moves or Escape,
// and resting the pointer on a name shows its card. The controller (`navigate`) answers from the
// statement around the place (editor/completion.js's window) only; nothing is asked while the
// dialect is not PostgreSQL's.

import { statementWindow } from "../editor/completion.js";
import { dialectFacet } from "../editor/lexing.js";
import {
  EditorSelection,
  hoverTooltip,
  keymap,
  Prec,
  StateEffect,
  StateField,
  showTooltip,
} from "../vendor/editor/editor-component.mjs";
import { renderCard } from "./card-view.js";

/**
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("../vendor/editor/editor-component.mjs").EditorView} View
 * @typedef {import("./controller.js").Answer} Answer
 * @typedef {import("./controller.js").What} What
 * @typedef {{ card: import("./card.js").Card, from: number, to: number }} Shown
 */

/** How long the pointer rests on a name before its card shows, in milliseconds. */
export const HOVER_MS = 400;

const set = StateEffect.define();

/** The card Alt+F12 shows, until the text or the caret moves. */
const field = StateField.define({
  create: () => /** @type {Shown | null} */ (null),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(set)) return /** @type {Shown | null} */ (e.value);
    return value && (tr.docChanged || tr.selection) ? null : value;
  },
  provide: (f) =>
    showTooltip.from(f, (shown) =>
      shown
        ? {
            pos: shown.from,
            end: shown.to,
            above: true,
            create: (view) => ({ dom: renderCard(view.dom.ownerDocument, shown.card) }),
          }
        : null,
    ),
});

/** @param {Act} act */
export function navigation(act) {
  const pg = (/** @type {View} */ view) => view.state.facet(dialectFacet) === "postgresql";
  /** @returns {Promise<Answer | null>} */
  const ask = async (
    /** @type {View} */ view,
    /** @type {What} */ what,
    /** @type {number} */ at,
  ) =>
    /** @type {Answer | null} */ (
      (await act("navigate", what, statementWindow(view.state, at))) ?? null
    );

  /** Run one of the three at the caret; false when the dialect has none. */
  const run = async (/** @type {View} */ view, /** @type {What} */ what) => {
    if (!pg(view)) {
      act("say", "Go to definition, the card and usages read PostgreSQL consoles.");
      return false;
    }
    const doc = view.state.doc;
    const answer = await ask(view, what, view.state.selection.main.head);
    // The text changed while the worker answered: its offsets are not this text's.
    if (view.state.doc !== doc) return true;
    if (answer?.move) {
      view.dispatch({
        selection: EditorSelection.range(answer.move.from, answer.move.to),
        scrollIntoView: true,
        userEvent: "select.definition",
      });
      view.focus();
    } else if (what === "card") {
      if (answer?.card)
        view.dispatch({
          effects: set.of({ card: answer.card, from: answer.from ?? 0, to: answer.to ?? 0 }),
        });
      else act("say", "The schema cache holds nothing to show for the name at the caret.");
    }
    return true;
  };

  const hover = hoverTooltip(
    async (view, pos) => {
      if (!pg(view)) return null;
      const doc = view.state.doc;
      const answer = await ask(view, "card", pos);
      if (!answer?.card || view.state.doc !== doc) return null;
      const card = answer.card;
      return {
        pos: answer.from ?? pos,
        end: answer.to ?? pos,
        above: true,
        create: () => ({ dom: renderCard(view.dom.ownerDocument, card) }),
      };
    },
    { hoverTime: HOVER_MS },
  );

  /** A key's command: runs in the background, the key is taken. */
  const key = (/** @type {What} */ what) => (/** @type {View} */ view) => {
    void run(view, what);
    return true;
  };
  const keys = Prec.high(
    keymap.of([
      {
        key: "F12",
        run: key("definition"),
        shift: key("usages"),
        preventDefault: true,
      },
      { key: "Alt-F12", run: key("card"), preventDefault: true },
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(field)) return false;
          view.dispatch({ effects: set.of(null) });
          return true;
        },
      },
    ]),
  );

  return { extension: [field, hover, keys], run };
}
