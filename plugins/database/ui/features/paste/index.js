// Paste, duplicate, fill down, clear and undo in the grid (PG-43, #470): each works on the grid on
// screen (view.grid: where its cells land and the text read, in a worker when it is big, grid/
// paste.js), is planned on the pending changes of the result shown (edit/cells.js, edit/
// duplicate.js) and, unless a value is refused, applied as one undoable step (edits.js). A paste of
// more than 1,000 cells asks first. Nothing runs until Submit. Database: paste takes `text` (an
// agent's paste, under the same refusals); without it the clipboard is read where the desk lets the
// page. No DOM.

import { applyCells, fillDownValues, PASTE_ASK, planCells, refusalOf } from "../../edit/cells.js";
import { duplicateRows } from "../../edit/duplicate.js";
import { formatCount } from "../../format.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../edit/cells.js").At} At
 * @typedef {import("../../edit/cells.js").Plan} Plan
 * @typedef {import("../../edit/paste-text.js").Pasted} Pasted
 */

const counted = (/** @type {number} */ n, /** @type {string} */ word) =>
  `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
const listed = (/** @type {string[]} */ names) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** An operation of the grid on screen: no grid throws what to do, words are a refusal. */
async function onGrid(
  /** @type {Deps} */ deps,
  /** @type {string} */ op,
  /** @type {Record<string, unknown>} */ args = {},
) {
  const got = await deps.view.grid?.(op, args);
  if (got === undefined) throw new Error("No result is on screen: run a query or open a table.");
  if (typeof got === "string") throw new Error(got);
  return got;
}

/** The result on screen when its rows can change, and where its selection is. */
async function selected(/** @type {Deps} */ deps) {
  const { state, set } = await deps.consoles.edits.ready();
  const at = /** @type {At} */ (await onGrid(deps, "cells"));
  return { state, set, at };
}

/** Apply a plan as one step, unless a value of it is refused; answers what was done, said. */
function apply(
  /** @type {Deps} */ deps,
  /** @type {import("../../edits.js").EditState} */ state,
  /** @type {Plan} */ plan,
  /** @type {string} */ words,
) {
  deps.consoles.edits.step(state, (changes, target, set) => applyCells(changes, target, set, plan));
  deps.say(words);
  return words;
}

/** Paste text (the clipboard's when none is given) from the caret. */
async function paste(/** @type {Deps} */ deps, /** @type {unknown} */ given) {
  const { state, set, at } = await selected(deps);
  const text =
    typeof given === "string"
      ? given
      : /** @type {{ text: string }} */ (await onGrid(deps, "clipboard")).text;
  if (text === "") throw new Error("Nothing to paste: the clipboard holds no text.");
  const read = /** @type {Pasted} */ (await onGrid(deps, "readPaste", { text }));
  const { target, changes } = state;
  const plan = planCells({ target, set, changes, at, values: read.rows });
  const refused = refusalOf(plan, "pasted");
  if (refused) throw new Error(refused);
  const added = plan.added ? `, ${formatCount(plan.added)} of them new` : "";
  if (plan.cells.length > PASTE_ASK) {
    const ok = await deps.confirm(`Paste ${formatCount(plan.cells.length)} cells?`, [
      `${counted(plan.rows, "row")} by ${counted(plan.width, "column")}${added}, pending until Submit.`,
    ]);
    if (!ok) throw deps.cancelled("Not pasted: nothing changed.");
  }
  const header = plan.header ? "The first line names the columns, so it is left out. " : "";
  const cells = counted(plan.cells.length, "cell");
  return apply(
    deps,
    state,
    plan,
    `${header}Pasted ${cells} into ${counted(plan.rows, "row")}${added}: pending until Submit.`,
  );
}

/** Fill the block's top row down into the rows below it in the block. */
async function fillDown(/** @type {Deps} */ deps) {
  const { state, set, at } = await selected(deps);
  const fill = fillDownValues(set, state.changes, at);
  const plan = planCells({ target: state.target, set, changes: state.changes, ...fill });
  const refused = refusalOf(plan, "filled");
  if (refused) throw new Error(refused);
  const words = `Filled ${counted(plan.cells.length, "cell")} down: pending until Submit.`;
  return apply(deps, state, plan, words);
}

/** Set every selected cell to NULL. */
async function clear(/** @type {Deps} */ deps) {
  const { state, set, at } = await selected(deps);
  const plan = planCells({
    target: state.target,
    set,
    changes: state.changes,
    at,
    values: [[null]],
  });
  const refused = refusalOf(plan, "cleared");
  if (refused) throw new Error(refused);
  const words = `Set ${counted(plan.cells.length, "cell")} to NULL: pending until Submit.`;
  return apply(deps, state, plan, words);
}

/** Duplicate the selected rows as pending rows at the end. */
async function duplicate(/** @type {Deps} */ deps) {
  const { state, at } = await selected(deps);
  const rows = at.order.slice(at.top, at.bottom + 1);
  if (rows.length === 0) throw new Error("Select a row to duplicate first.");
  const done = deps.consoles.edits.step(state, (changes, target, set) =>
    duplicateRows(changes, target, set, rows),
  );
  const n = done.added;
  const what = n === 1 ? "1 row as a pending row" : `${formatCount(n)} rows as pending rows`;
  const left = done.left.length
    ? `; ${listed(done.left)} take${done.left.length === 1 ? "s its" : " their"} DEFAULT`
    : "";
  const keys = done.keys.length
    ? ` Change ${listed(done.keys)} before Submit: a key must differ.`
    : "";
  const words = `Duplicated ${what} at the end${left}.${keys}`;
  deps.say(words);
  return words;
}

/** Take back the last pending change of the result on screen. */
function undo(/** @type {Deps} */ deps) {
  const words = deps.consoles.edits.undo()
    ? "Took back the last pending change."
    : "Nothing to undo.";
  deps.say(words);
  return words;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "paste",
  commands: (deps) => ({
    "endue.database.paste": ({ text }) => paste(deps, text),
    "endue.database.duplicate-rows": () => duplicate(deps),
    "endue.database.fill-down": () => fillDown(deps),
    "endue.database.clear-cells": () => clear(deps),
    "endue.database.undo-change": () => undo(deps),
  }),
  actions: (deps) => ({
    pasteText: (/** @type {string} */ text) => paste(deps, text),
    duplicateRows: () => duplicate(deps),
    fillDown: () => fillDown(deps),
    clearCells: () => clear(deps),
    undoChange: () => undo(deps),
  }),
};
