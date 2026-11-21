// What a key in the grid does (keys.js maps the press to an action name) and what a command asks
// the grid for by name (features/grid/): the cursor moved, a cell edited or set NULL, rows added,
// deleted or taken back, the record view, and the shape of the result (shaping.js) and find
// (finder.js). Shift+F3 finds the previous match and Shift+F10 opens the cell's menu, which a
// binding cannot say.

import { actionFor, extending, pressOf } from "../keys.js";
import { ROW } from "../view-grid-draw.js";

/**
 * @typedef {import("./shaping.js").createShaping} CreateShaping
 * @typedef {ReturnType<CreateShaping>} Shaping
 * @typedef {ReturnType<import("./finder.js").createFinder>} Finder
 * @typedef {{
 *   grid: HTMLElement, scroller: HTMLElement, act(action: string, ...args: unknown[]): unknown,
 *   shaping: Shaping, finder: Finder, editing(): boolean, record(): boolean, column(): number,
 *   size(): { rows: number, cols: number }, cursor(): { row: number, col: number },
 *   moveTo(row: number, col: number, extend: boolean): void, records(step: number): void,
 *   startEdit(): void, cursorCell(): ({ row: number, col: number, editable: boolean, reason: string } | undefined),
 *   blockRows(): number[], addRow(): void, toggleRecord(): unknown, openMenu(): void,
 *   say(words: string | undefined): unknown,
 * }} KeysHeld
 */

/** @param {KeysHeld} g */
export function createGridKeys(g) {
  const { act, shaping, finder } = g;
  const go = (/** @type {number} */ dr, /** @type {number} */ dc, extend = false) =>
    g.moveTo(g.cursor().row + dr, g.cursor().col + dc, extend);
  const page = () => Math.max(1, Math.floor((g.scroller.clientHeight || 480) / ROW) - 1);

  /** @type {Record<string, () => unknown>} */
  const steps = {
    down: () => go(1, 0),
    up: () => go(-1, 0),
    right: () => go(0, 1),
    left: () => go(0, -1),
    pageDown: () => (g.record() ? g.records(1) : go(page(), 0)),
    pageUp: () => (g.record() ? g.records(-1) : go(-page(), 0)),
    home: () => g.moveTo(0, g.cursor().col, false),
    end: () => g.moveTo(g.size().rows - 1, g.cursor().col, false),
    sort: () => shaping.sortBy(g.column(), false),
    addSort: () => shaping.sortBy(g.column(), true),
    menu: () => g.openMenu(),
    filterCell: () => shaping.filter("eq"),
    clearFilters: () => shaping.clearFilters(),
    find: () => finder.open(undefined),
    findNext: () => finder.step(1),
    findPrevious: () => finder.step(-1),
    hide: () => shaping.hide(),
    showColumns: () => act("showColumns"),
    moveLeft: () => shaping.move(-1),
    moveRight: () => shaping.move(1),
    pin: () => shaping.pin(),
    fit: () => shaping.fit(undefined),
    narrower: () => shaping.widen(-1),
    wider: () => shaping.widen(1),
    reset: () => shaping.reset(),
    edit: () => g.startEdit(),
    value: () => act("value", g.cursorCell()),
    null: () => {
      const cell = g.cursorCell();
      if (cell?.editable) act("editCell", cell.row, cell.col, null);
      else act("say", cell?.reason || "This cell cannot change.");
    },
    addRow: () => g.addRow(),
    deleteRows: () => act("deleteRows", g.blockRows()),
    revertRows: () => act("revertRows", g.blockRows()),
    record: () => g.toggleRecord(),
    editor: () => (finder.el.hidden ? act("editor") : finder.close()),
  };

  /** Run an action: the grid's own, or the view's. A refusal comes back as words. */
  const run = (/** @type {string} */ action) => {
    const step = steps[action];
    const done = step ? step() : act(action);
    return typeof done === "string" ? done : "";
  };

  g.grid.addEventListener("keydown", (event) => {
    if (g.editing() || event.isComposing) return;
    const press = pressOf(event);
    if (extending(press)) {
      const moves = /** @type {Record<string, [number, number]>} */ ({
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
      });
      const [dr, dc] = moves[press.key] ?? [0, 0];
      event.preventDefault();
      return go(dr, dc, true);
    }
    const shifted = press.shift && !press.mod && !press.alt;
    const action =
      shifted && press.key === "F3"
        ? "findPrevious"
        : shifted && press.key === "F10"
          ? "menu"
          : actionFor("grid", press);
    if (!action) return;
    event.preventDefault();
    g.say(run(action));
  });

  return {
    run: (/** @type {string} */ action) => g.say(run(action)),
    /**
     * An operation by name, as a command asks for it: one of the actions above, `show` a hidden
     * column (`column`), `filter` by the cursor's cell (`op`, and `value` for contains), `find`
     * (`text`). Answers "" or the words of a refusal.
     */
    command(/** @type {string} */ op, /** @type {Record<string, unknown>} */ args) {
      if (op === "show") {
        shaping.show(String(args.column ?? ""));
        return "";
      }
      if (op === "filter")
        return shaping.filter(
          /** @type {never} */ (String(args.op)),
          typeof args.value === "string" ? args.value : undefined,
        );
      if (op === "find") {
        finder.open(typeof args.text === "string" ? args.text : undefined);
        return "";
      }
      return run(op);
    },
  };
}
