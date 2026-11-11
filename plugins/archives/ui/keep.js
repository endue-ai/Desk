// What Archives keeps of each open archive when the desk puts its window to sleep (ui.surface.state,
// ADR 0070, ADR 0176), through the SDK's keepFiles: the levels opened one inside another (the entry
// each was opened from), in each its open folders, the selected row and the marked ones; the row at
// the top of the tree, the sort and the filter; and the file's watch. Archives reads and never edits,
// so nothing unsaved is kept.
import { parentOf } from "./formats/archive.js";

/**
 * @typedef {import("./tree.js").Sort} Sort
 * @typedef {import("./opening.js").Level} Level
 * @typedef {{ from?: string, expanded: string[], selected: string | null, marked: string[] }} KeptLevel
 * @typedef {{ levels: KeptLevel[], top?: number, sort?: Sort, filter?: string, watchId?: string }} KeptPlace
 */

/** Open folders and marks kept per level: more than a person opens or marks by hand. */
export const MAX_IDS = 1000;
/** Levels kept: archives inside archives, deeper than anyone goes. */
const MAX_LEVELS = 16;
const SORTS = new Set(["name", "size", "date"]);

/** The folders `id` is in, the outermost first. @param {string | null} id */
const ancestors = (id) => {
  /** @type {string[]} */
  const chain = [];
  for (let at = parentOf(id ?? ""); at !== ""; at = parentOf(at)) chain.unshift(at);
  return chain;
};

/**
 * One level as kept: the open folders on the way to the selected row first, so a cut keeps them.
 * @param {Level} at
 * @returns {KeptLevel}
 */
function levelOf(at) {
  const first = ancestors(at.selected).filter((id) => at.expanded.has(id));
  const rest = [...at.expanded].filter((id) => !first.includes(id));
  return {
    ...(at.from !== undefined ? { from: at.from } : {}),
    expanded: [...first, ...rest].slice(0, MAX_IDS),
    selected: at.selected,
    marked: [...at.marked].slice(0, MAX_IDS),
  };
}

/**
 * The place to keep for an open archive.
 * @param {{ levels: Level[], watchId?: string, top?: number }} file
 * @param {{ sort: Sort, filter: string }} frame the sort and the filter the frame shows every file with
 * @returns {KeptPlace}
 */
export const placeOf = (file, { sort, filter }) => ({
  levels: file.levels.slice(0, MAX_LEVELS).map(levelOf),
  ...(file.top !== undefined && file.top > 0 ? { top: file.top } : {}),
  sort,
  ...(filter ? { filter } : {}),
  ...(file.watchId ? { watchId: file.watchId } : {}),
});

const isId = (/** @type {unknown} */ v) => typeof v === "string";
const ids = (/** @type {unknown} */ v) =>
  Array.isArray(v) ? /** @type {string[]} */ (v.filter(isId)).slice(0, MAX_IDS) : [];

/** @param {unknown} value @returns {KeptLevel | undefined} */
function readLevel(value) {
  const level = /** @type {Record<string, unknown> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!level) return undefined;
  return {
    ...(isId(level.from) ? { from: /** @type {string} */ (level.from) } : {}),
    expanded: ids(level.expanded),
    selected: isId(level.selected) ? /** @type {string} */ (level.selected) : null,
    marked: ids(level.marked),
  };
}

/**
 * A kept place as Archives keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {Record<string, unknown> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place) return undefined;
  /** @type {KeptLevel[]} */
  const levels = [];
  for (const raw of Array.isArray(place.levels) ? place.levels.slice(0, MAX_LEVELS) : []) {
    const level = readLevel(raw);
    // Every level below the first names the entry it was opened from; one that does not ends it.
    if (!level || (levels.length > 0 && level.from === undefined)) break;
    levels.push(level);
  }
  const sort = /** @type {{ by?: unknown, descending?: unknown } | null} */ (
    typeof place.sort === "object" ? place.sort : null
  );
  const top = place.top;
  return {
    levels,
    ...(Number.isInteger(top) && /** @type {number} */ (top) > 0
      ? { top: /** @type {number} */ (top) }
      : {}),
    ...(sort && SORTS.has(/** @type {string} */ (sort.by))
      ? {
          sort: {
            by: /** @type {Sort["by"]} */ (sort.by),
            descending: sort.descending === true,
          },
        }
      : {}),
    ...(typeof place.filter === "string" && place.filter ? { filter: place.filter } : {}),
    ...(typeof place.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}

/**
 * Put a kept level's open folders, selection and marks back on a level just opened, as far as its
 * tree still has them.
 * @param {Level} at @param {KeptLevel | undefined} kept
 */
export function applyLevel(at, kept) {
  if (!kept) return;
  const has = (/** @type {string} */ id) => at.tree.byId.has(id);
  at.expanded = new Set(kept.expanded.filter((id) => at.tree.byId.get(id)?.kind === "folder"));
  at.marked = new Set(kept.marked.filter(has));
  if (kept.selected !== null && has(kept.selected)) at.selected = kept.selected;
}
