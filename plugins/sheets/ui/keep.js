// What Sheets keeps of each open file when the desk puts its window to sleep (ui.surface.state, ADR
// 0070, ADR 0176), through the SDK's keepFiles: the sheet on screen, the selection and scroll on
// each sheet the person looked at, the zoom and the file's watch; and a CSV's unsaved edits as the
// cells they set, with the size and a fingerprint of the bytes they were made on, so they go back
// only on that file: one that changed on disk meanwhile opens as it is there, and the person is told.
/**
 * @typedef {import("./grid.js").Place} GridPlace
 * @typedef {import("./csv-edit.js").CsvDoc} CsvDoc
 * @typedef {{ sheet: number, places: Array<[number, GridPlace]>, zoom?: number }} Where
 *   where the person was in one file, as the view says it (view.js where)
 * @typedef {Partial<Where> & { watchId?: string }} KeptPlace
 * @typedef {{ cells: Array<[number, number, string]>, size: number, sum: string, reported: boolean }} KeptEdit
 *   cells: [row, column, text] of each field that differs from the file; size and sum: its bytes
 */

/** Two 32-bit hashes of the bytes (FNV-1a and djb2), as 16 hex digits. */
export function bytesSum(/** @type {Uint8Array} */ bytes) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    fnv = Math.imul(fnv ^ byte, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ byte) >>> 0;
  }
  return fnv.toString(16).padStart(8, "0") + djb.toString(16).padStart(8, "0");
}

/** A file's bytes do not change once read: each is hashed once, however often its window sleeps. */
const sums = new WeakMap();
const sumOf = (/** @type {Uint8Array} */ bytes) => {
  let sum = sums.get(bytes);
  if (sum === undefined) {
    sum = bytesSum(bytes);
    sums.set(bytes, sum);
  }
  return sum;
};

/**
 * The place to keep for an open file: where the view says the person was, and its watch.
 * @param {Where | undefined} where
 * @param {string | undefined} watchId
 * @returns {KeptPlace | undefined}
 */
export function placeOf(where, watchId) {
  const place = { ...(where ?? {}), ...(watchId ? { watchId } : {}) };
  return Object.keys(place).length > 0 ? place : undefined;
}

/**
 * The unsaved edits of a CSV document, or none.
 * @param {CsvDoc | undefined} doc
 * @param {boolean} reported whether the desk was told the file is unsaved
 * @returns {KeptEdit[]}
 */
export function editsOf(doc, reported) {
  if (!doc?.modified) return [];
  const { bytes } = doc.syntax;
  return [{ cells: doc.edits(), size: bytes.length, sum: sumOf(bytes), reported }];
}

/**
 * Put kept edits back on a document opened from disk again; false when it is not the file they
 * were made on (it changed meanwhile, or opened in another encoding) and nothing was changed.
 * @param {CsvDoc | undefined} doc
 * @param {KeptEdit} edit
 */
export function applyEdits(doc, edit) {
  if (!doc) return false;
  const { bytes } = doc.syntax;
  if (bytes.length !== edit.size || sumOf(bytes) !== edit.sum) return false;
  if (edit.cells.some(([r, c]) => !doc.editable(r, c))) return false;
  for (const [r, c, text] of edit.cells) doc.set(r, c, text);
  return true;
}

const isIndex = (/** @type {unknown} */ v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0;
const isOffset = (/** @type {unknown} */ v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const isAddress = (/** @type {unknown} */ v) => {
  const at = /** @type {{ r?: unknown, c?: unknown } | null} */ (v);
  return typeof at === "object" && at !== null && isIndex(at.r) && isIndex(at.c);
};

/**
 * A kept grid place, or undefined (another version's).
 * @param {unknown} value
 * @returns {GridPlace | undefined}
 */
function readGridPlace(value) {
  const place = /** @type {Partial<Record<keyof GridPlace, unknown>> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place || !isAddress(place.active) || !isAddress(place.end)) return undefined;
  if (!isOffset(place.top) || !isOffset(place.left)) return undefined;
  const { active, end, top, left } = /** @type {GridPlace} */ (place);
  return { active: { r: active.r, c: active.c }, end: { r: end.r, c: end.c }, top, left };
}

/**
 * A kept place as Sheets keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place =
    /** @type {{ sheet?: unknown, places?: unknown, zoom?: unknown, watchId?: unknown } | null} */ (
      typeof value === "object" && value !== null ? value : null
    );
  if (!place) return undefined;
  /** @type {Array<[number, GridPlace]>} */
  const places = [];
  for (const entry of Array.isArray(place.places) ? place.places : []) {
    const [index, at] = Array.isArray(entry) ? entry : [];
    const read = isIndex(index) ? readGridPlace(at) : undefined;
    if (read) places.push([/** @type {number} */ (index), read]);
  }
  // The grid takes the nearest of its own steps.
  const zoom =
    typeof place.zoom === "number" && place.zoom >= 0.25 && place.zoom <= 4
      ? place.zoom
      : undefined;
  return {
    ...(isIndex(place.sheet) ? { sheet: /** @type {number} */ (place.sheet), places } : {}),
    ...(zoom === undefined ? {} : { zoom }),
    ...(typeof place.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}

/**
 * A kept edit as Sheets keeps one, or undefined: the file then comes back as it is on disk.
 * @param {unknown} value
 * @returns {KeptEdit | undefined}
 */
export function readEdit(value) {
  const edit = /** @type {Partial<Record<keyof KeptEdit, unknown>> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!edit || !isIndex(edit.size) || typeof edit.sum !== "string") return undefined;
  if (!Array.isArray(edit.cells) || edit.cells.length === 0) return undefined;
  /** @type {Array<[number, number, string]>} */
  const cells = [];
  for (const cell of edit.cells) {
    const [r, c, text] = Array.isArray(cell) ? cell : [];
    if (!isIndex(r) || !isIndex(c) || typeof text !== "string") return undefined;
    cells.push([/** @type {number} */ (r), /** @type {number} */ (c), text]);
  }
  return {
    cells,
    size: /** @type {number} */ (edit.size),
    sum: edit.sum,
    reported: edit.reported === true,
  };
}
