// The explorer's selection of several rows (#313), without its DOM: the range from an anchor to a row,
// one row toggled, every row on screen, what the status line says of the count, and the entries a
// change acts on (a folder and something inside it go as the folder). Pure functions over the rows.
import { isUnder } from "./tree.js";

/** @typedef {import("./tree.js").Row} Row */

/** Whether a row can be selected with others: an entry, never a folder's "more" row. */
export const pickable = (/** @type {Row | undefined} */ row) =>
  row !== undefined && row.kind !== "more";

/**
 * The ids from `anchor` to `id` in the order shown, either way; the row alone without an anchor on
 * screen.
 * @param {Row[]} list @param {string | null} anchor @param {string} id
 */
export function range(list, anchor, id) {
  const to = list.findIndex((row) => row.id === id);
  if (to < 0) return [];
  const from = list.findIndex((row) => row.id === anchor);
  const [start, end] = from < 0 ? [to, to] : from < to ? [from, to] : [to, from];
  return list
    .slice(start, end + 1)
    .filter(pickable)
    .map((row) => row.id);
}

/** `marks` with `id` added, or taken out when it was there. */
export function toggle(/** @type {ReadonlySet<string>} */ marks, /** @type {string} */ id) {
  const next = new Set(marks);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Every row on screen but the "more" rows. @param {Row[]} list */
export const all = (list) => new Set(list.filter(pickable).map((row) => row.id));

/** What the status line says of a selection of `count` rows: nothing for one. */
export const spoken = (/** @type {number} */ count) => (count > 1 ? `${count} selected` : "");

/** The paths of `rows` without those inside another of them, in the order given. */
export function outermost(/** @type {string[]} */ paths) {
  return paths.filter((path) => !paths.some((other) => other !== path && isUnder(other, path)));
}

/**
 * The rows selected together and the anchor a range runs from, over the rows on screen. Every change
 * says the count on the status line (`say`), a live region a screen reader hears.
 * @param {{ rows(): Row[], say(text: string): void }} deps
 */
export function createPicking({ rows, say }) {
  /** @type {Set<string>} */
  let marks = new Set();
  /** @type {string | null} */
  let anchor = null;
  const said = () => say(spoken(marks.size));
  return {
    marks: () => /** @type {ReadonlySet<string>} */ (marks),
    /** One row alone, which a range then runs from. */
    only(/** @type {string | null} */ id) {
      marks = id === null ? new Set() : new Set([id]);
      anchor = id;
    },
    /** Shift: the range from the anchor to `id`; Mod: `id` toggled, and the anchor. */
    pick(/** @type {string} */ id, /** @type {{ shift?: boolean }} */ mods) {
      if (mods.shift) marks = new Set(range(rows(), anchor, id));
      else {
        marks = toggle(marks, id);
        anchor = id;
      }
      said();
    },
    /** Shift+arrows: the range from the anchor to where the focus went. */
    extend(/** @type {string} */ id) {
      marks = new Set(range(rows(), anchor ?? id, id));
      said();
    },
    /** Every row on screen; how many. */
    all() {
      marks = all(rows());
      said();
      return marks.size;
    },
    /** Rows no longer on screen leave; with none left, the focused row is the selection. */
    prune(/** @type {string | null} */ focus) {
      const shown = new Set(rows().map((row) => row.id));
      marks = new Set([...marks].filter((id) => shown.has(id)));
      if (marks.size === 0 && focus !== null && shown.has(focus)) marks.add(focus);
    },
    /** The selected rows, in the order shown. */
    picked: () => rows().filter((row) => pickable(row) && marks.has(row.id)),
  };
}

/**
 * Type-ahead: letters typed within 700 ms of each other jump to the next row whose name starts with
 * them, or with the last letter alone.
 * @param {(list: Row[], selected: string | null, letters: string) => string | undefined} jump
 */
export function createTypeAhead(jump) {
  let typed = "";
  let typedAt = 0;
  return (
    /** @type {Row[]} */ list,
    /** @type {string | null} */ selected,
    /** @type {string} */ letter,
    /** @type {number} */ now,
  ) => {
    typed = now - typedAt < 700 ? typed + letter : letter;
    typedAt = now;
    let id = jump(list, selected, typed);
    if (id === undefined && typed !== letter) {
      typed = letter;
      id = jump(list, selected, letter);
    }
    return id;
  };
}
