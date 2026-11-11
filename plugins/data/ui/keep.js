// What Data keeps of each open file when the desk puts its window to sleep (ui.surface.state, ADR
// 0070, ADR 0176), through the SDK's keepFiles: how it was shown (tree, raw or both), which nodes
// were open and which was selected, and the file's watch; and its unsaved edits as the values they
// set ([path, text], the last of each), with the size and a fingerprint of the bytes they were made
// on, so they go back only on that file. A revealed secret is never kept.

/**
 * @typedef {"tree" | "raw" | "both"} Mode
 * @typedef {{ mode: Mode, expanded: string[], selected: string | null }} Where
 *   where the person was in one file, as the view says it (places.js)
 * @typedef {Partial<Where> & { watchId?: string }} KeptPlace
 * @typedef {[number[], string]} Value a value's path (root index, then child indexes) and its text
 * @typedef {{ values: Value[], size: number, sum: string, reported: boolean }} KeptEdit
 * @typedef {{ size: number, sum: string }} Base the bytes on disk the edits are made on
 */

/** Open nodes kept per file: enough for any tree a person opened by hand, never most of the 64 KiB. */
export const MAX_OPEN = 1000;
const MODES = new Set(["tree", "raw", "both"]);

/**
 * The place to keep for an open file: where the view says the person was, and its watch. The open
 * nodes on the way to the selected one come first, so they are kept whatever else is cut.
 * @param {Where | undefined} where
 * @param {string | undefined} watchId
 * @returns {KeptPlace | undefined}
 */
export function placeOf(where, watchId) {
  if (!where) return watchId ? { watchId } : undefined;
  const chain = (where.selected ?? "").split("/");
  const ancestors = chain.slice(0, -1).map((_, i) => chain.slice(0, i + 1).join("/"));
  const first = ancestors.filter((key) => where.expanded.includes(key));
  const rest = where.expanded.filter((key) => !first.includes(key));
  return {
    mode: where.mode,
    expanded: [...first, ...rest].slice(0, MAX_OPEN),
    selected: where.selected,
    ...(watchId ? { watchId } : {}),
  };
}

/**
 * The unsaved edits of an open file, or none.
 * @param {{ edited?: boolean, values?: Map<string, Value>, base?: Base }} file
 * @returns {KeptEdit[]}
 */
export function editsOf({ edited, values, base }) {
  if (!values?.size || !base) return [];
  return [{ values: [...values.values()], ...base, reported: edited === true }];
}

const isIndex = (/** @type {unknown} */ v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0;
const isKey = (/** @type {unknown} */ v) => typeof v === "string" && /^\d+(\/\d+)*$/u.test(v);

/**
 * A kept place as Data keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {Record<string, unknown> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place) return undefined;
  const expanded = Array.isArray(place.expanded)
    ? /** @type {string[]} */ (place.expanded.filter(isKey)).slice(0, MAX_OPEN)
    : [];
  const mode = MODES.has(/** @type {string} */ (place.mode))
    ? /** @type {Mode} */ (place.mode)
    : undefined;
  return {
    ...(mode
      ? {
          mode,
          expanded,
          selected: isKey(place.selected) ? /** @type {string} */ (place.selected) : null,
        }
      : {}),
    ...(typeof place.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}

/**
 * A kept edit as Data keeps one, or undefined: the file then comes back as it is on disk.
 * @param {unknown} value
 * @returns {KeptEdit | undefined}
 */
export function readEdit(value) {
  const edit = /** @type {Record<string, unknown> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!edit || !isIndex(edit.size) || typeof edit.sum !== "string") return undefined;
  if (!Array.isArray(edit.values) || edit.values.length === 0) return undefined;
  /** @type {Value[]} */
  const values = [];
  for (const entry of edit.values) {
    const [path, text] = Array.isArray(entry) ? entry : [];
    if (!Array.isArray(path) || path.length === 0 || !path.every(isIndex)) return undefined;
    if (typeof text !== "string") return undefined;
    values.push([/** @type {number[]} */ (path), text]);
  }
  return {
    values,
    size: /** @type {number} */ (edit.size),
    sum: edit.sum,
    reported: edit.reported === true,
  };
}
