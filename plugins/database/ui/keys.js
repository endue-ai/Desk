import { t } from "./strings/index.js";
// The keys inside the Database surface, one table per area. The explorer and the grid take single
// keys; the editor takes Mod+Enter (run the statement), Mod+Shift+Enter (run the script),
// Mod+Shift+F (format), Mod+Shift+Y and Mod+Shift+S (commit and roll back the console's transaction,
// PG-20), and Escape only while a run goes on; the grid takes Mod+Enter (submit the
// pending changes), Mod+F (find in the result: the grid's own, never the editor's) and Mod+Z (undo a
// pending change). Mod+V is listed for the hint line but left to the browser, whose paste event the
// grid reads (grid/paste.js). Every other chord with Mod, Alt or Control is left to the desk, except
// the editor's Ctrl+Space, which view-editor.js reads itself. Pure: `actionFor` maps a key press to
// an action name, `hints` lists an area's keys.

/**
 * @typedef {"explorer" | "editor" | "grid"} Area
 * @typedef {{ key: string, mod: boolean, shift: boolean, alt: boolean }} KeyPress
 * @typedef {{ chord: string, action: string, label: string }} Binding
 */

/** @type {Record<Area, Binding[]>} */
export const BINDINGS = {
  explorer: [
    { chord: "Enter", action: "activate", label: t("keys.open") },
    { chord: "ArrowRight", action: "expand", label: "" },
    { chord: "ArrowLeft", action: "collapse", label: "" },
    { chord: "ArrowDown", action: "next", label: "" },
    { chord: "ArrowUp", action: "previous", label: "" },
    { chord: "Home", action: "first", label: "" },
    { chord: "End", action: "last", label: "" },
    { chord: "n", action: "create", label: t("keys.new") },
    { chord: "e", action: "edit", label: t("keys.edit") },
    { chord: "Delete", action: "remove", label: t("keys.remove") },
    { chord: "g", action: "refresh", label: t("keys.refresh") },
    { chord: "d", action: "ddl", label: t("keys.ddl") },
    { chord: "c", action: "count", label: t("keys.countRows") },
    { chord: "r", action: "diagram", label: t("keys.erDiagram") },
    { chord: "m", action: "maintain", label: t("keys.maintenance") },
    { chord: "x", action: "routine", label: t("keys.runRoutine") },
    { chord: "f", action: "searchData", label: t("keys.findAValue") },
    { chord: "/", action: "filter", label: t("keys.filter") },
    { chord: "u", action: "importUri", label: t("keys.fromUri") },
    { chord: "o", action: "objectMenu", label: t("keys.objectMenu") },
    { chord: "ContextMenu", action: "objectMenu", label: "" },
    { chord: "F2", action: "renameObject", label: t("keys.rename") },
    { chord: "s", action: "editSource", label: t("keys.source") },
    { chord: "p", action: "privileges", label: t("keys.privileges") },
  ],
  editor: [
    { chord: "Mod+Enter", action: "run", label: t("keys.runStatement") },
    { chord: "Mod+Shift+Enter", action: "runAll", label: t("keys.runScript") },
    { chord: "Mod+Shift+F", action: "format", label: t("keys.format") },
    // The console's transaction (features/transactions/, PG-20): Commit and Rollback.
    { chord: "Mod+Shift+Y", action: "commitTransaction", label: "" },
    { chord: "Mod+Shift+S", action: "rollbackTransaction", label: "" },
    { chord: "F2", action: "renameAtCaret", label: "" },
    // Eris in a console (features/assist/, PG-90): write, explain, fix, explain the plan.
    { chord: "Mod+I", action: "assistWrite", label: "" },
    { chord: "Mod+E", action: "assistExplain", label: "" },
    { chord: "Mod+J", action: "assistFix", label: "" },
    { chord: "Mod+Shift+H", action: "assistPlan", label: "" },
    { chord: "Escape", action: "cancel", label: t("keys.cancel") },
  ],
  grid: [
    { chord: "ArrowDown", action: "down", label: "" },
    { chord: "ArrowUp", action: "up", label: "" },
    { chord: "ArrowRight", action: "right", label: "" },
    { chord: "ArrowLeft", action: "left", label: "" },
    { chord: "PageDown", action: "pageDown", label: "" },
    { chord: "PageUp", action: "pageUp", label: "" },
    { chord: "Home", action: "home", label: "" },
    { chord: "End", action: "end", label: "" },
    { chord: "Enter", action: "edit", label: t("keys.edit") },
    { chord: "F2", action: "edit", label: "" },
    { chord: "v", action: "value", label: t("keys.value") },
    { chord: "n", action: "null", label: t("keys.null") },
    { chord: "+", action: "addRow", label: t("keys.addRow") },
    { chord: "Insert", action: "addRow", label: "" },
    { chord: "Delete", action: "deleteRows", label: t("keys.delete") },
    { chord: "Backspace", action: "deleteRows", label: "" },
    { chord: "u", action: "revertRows", label: t("keys.revert") },
    { chord: "Mod+V", action: "paste", label: t("keys.paste") },
    { chord: "D", action: "duplicateRows", label: t("keys.duplicate") },
    { chord: '"', action: "fillDown", label: t("keys.fillDown") },
    { chord: "Mod+Z", action: "undoChange", label: t("keys.undo") },
    { chord: "p", action: "previewChanges", label: t("keys.preview") },
    { chord: "Mod+Enter", action: "submitChanges", label: t("keys.submit") },
    { chord: "s", action: "sort", label: t("keys.sort") },
    { chord: "S", action: "addSort", label: t("keys.sortByMore") },
    { chord: "f", action: "menu", label: t("keys.filter") },
    { chord: "=", action: "filterCell", label: "" },
    { chord: "F", action: "clearFilters", label: "" },
    { chord: "Mod+F", action: "find", label: t("keys.find") },
    { chord: "F3", action: "findNext", label: "" },
    { chord: "h", action: "hide", label: t("keys.hide") },
    { chord: "H", action: "showColumns", label: "" },
    { chord: "<", action: "moveLeft", label: "" },
    { chord: ">", action: "moveRight", label: "" },
    { chord: "P", action: "pin", label: t("keys.pin") },
    { chord: "w", action: "fit", label: t("keys.fit") },
    { chord: "(", action: "narrower", label: "" },
    { chord: ")", action: "wider", label: "" },
    { chord: "ContextMenu", action: "menu", label: "" },
    { chord: "t", action: "record", label: t("keys.record") },
    { chord: "g", action: "followKey", label: t("keys.followKey") },
    { chord: "r", action: "referencingRows", label: "" },
    { chord: "b", action: "goBack", label: "" },
    { chord: "/", action: "quick", label: t("keys.filter") },
    { chord: "m", action: "more", label: t("keys.moreRows") },
    { chord: "[", action: "previousTab", label: "" },
    { chord: "]", action: "nextTab", label: "" },
    { chord: "Escape", action: "editor", label: t("keys.back") },
  ],
};

/** Chords this surface keeps from the desk, by area. */
const CHORDS = new Set(["Mod+Enter", "Mod+Shift+Enter", "Mod+Shift+F", "Mod+F", "Mod+Z"]);
// Eris's keys in the editor (features/assist/), which no desk-wide key takes.
for (const chord of ["Mod+I", "Mod+E", "Mod+J", "Mod+Shift+H"]) CHORDS.add(chord);
// Commit and Rollback in the editor (features/transactions/), which no desk-wide key takes.
for (const chord of ["Mod+Shift+Y", "Mod+Shift+S"]) CHORDS.add(chord);

/**
 * The action a key press runs in an area, or undefined when the desk (or the field) should have it.
 * @param {Area} area
 * @param {KeyPress} press
 * @param {{ running?: boolean }} [state]
 */
export function actionFor(area, press, state = {}) {
  if (press.alt) return undefined;
  // With Mod, a letter is the same chord in either case (macOS reports Cmd+Shift+F as "f").
  const key = press.mod && press.key.length === 1 ? press.key.toUpperCase() : press.key;
  const name = `${press.mod ? "Mod+" : ""}${press.mod && press.shift ? "Shift+" : ""}${key}`;
  if (press.mod && !CHORDS.has(name)) return undefined;
  if (area === "editor" && name === "Escape" && !state.running) return undefined;
  const plain = press.shift && !press.mod && press.key.length > 1 ? undefined : name;
  return BINDINGS[area].find((binding) => binding.chord === plain)?.action;
}

/** Shift with an arrow extends the grid's selection. */
export const extending = (/** @type {KeyPress} */ press) =>
  press.shift && !press.mod && press.key.startsWith("Arrow");

/** The hint line of an area: "Enter open · n new · …". */
export function hints(/** @type {Area} */ area) {
  return BINDINGS[area]
    .filter((binding) => binding.label !== "")
    .map((binding) => `${binding.chord} ${binding.label}`)
    .join(" · ");
}

/**
 * A DOM keyboard event as a key press. Mod is Meta on macOS and Control elsewhere; either counts.
 * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean }} event
 * @returns {KeyPress}
 */
export function pressOf(event) {
  return {
    key: event.key,
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}
