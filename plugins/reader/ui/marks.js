// What the reader keeps per file, in its own store (store.get, store.set) under a key made from the
// file's path, never in the file: the last position and zoom, bookmarks and notes. A moved file
// loses them. The store holds 64 KiB a key; the oldest notes go first when a file's marks outgrow it.

/**
 * @typedef {{ unit: number, offset: number }} At
 * @typedef {{ unit: number, offset: number, label: string, added: string }} Bookmark
 * @typedef {{ unit: number, offset: number, text: string, added: string }} Note
 * @typedef {{ at: At, zoom: number | null, bookmarks: Bookmark[], notes: Note[] }} Marks
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

const LIMIT = 60 * 1024;
export const NOTE_MAX = 4000;

/** FNV-1a, 64 bits, as 16 hex digits: store keys allow only [a-z0-9._-]. */
export function hash(/** @type {string} */ text) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export const keyFor = (/** @type {string} */ path) => `file.${hash(path)}`;

export const emptyMarks = () =>
  /** @type {Marks} */ ({ at: { unit: 0, offset: 0 }, zoom: null, bookmarks: [], notes: [] });

const isAt = (/** @type {any} */ v) =>
  v && Number.isInteger(v.unit) && v.unit >= 0 && typeof v.offset === "number";

/** The marks kept for `path`, or none when the key holds another path's (a hash collision). */
export async function loadMarks(/** @type {Bridge} */ bridge, /** @type {string} */ path) {
  const kept = /** @type {{ value?: any }} */ (
    await bridge.call("store.get", { key: keyFor(path) }).catch(() => ({}))
  );
  const value = kept.value;
  const marks = emptyMarks();
  if (!value || value.path !== path) return marks;
  if (isAt(value)) marks.at = { unit: value.unit, offset: Math.max(0, Math.min(1, value.offset)) };
  if (typeof value.zoom === "number" && value.zoom > 0) marks.zoom = value.zoom;
  if (Array.isArray(value.bookmarks))
    marks.bookmarks = value.bookmarks.filter((b) => isAt(b) && typeof b.label === "string");
  if (Array.isArray(value.notes))
    marks.notes = value.notes.filter((n) => isAt(n) && typeof n.text === "string");
  return marks;
}

/** Keep the marks for `path`. Resolves false when the store refused them. */
export async function saveMarks(
  /** @type {Bridge} */ bridge,
  /** @type {string} */ path,
  /** @type {Marks} */ marks,
) {
  const value = {
    path,
    unit: marks.at.unit,
    offset: Math.round(marks.at.offset * 10000) / 10000,
    zoom: marks.zoom,
    bookmarks: marks.bookmarks,
    notes: marks.notes,
  };
  while (value.notes.length > 0 && JSON.stringify(value).length > LIMIT)
    value.notes = value.notes.slice(1);
  while (value.bookmarks.length > 0 && JSON.stringify(value).length > LIMIT)
    value.bookmarks = value.bookmarks.slice(1);
  return bridge.call("store.set", { key: keyFor(path), value }).then(
    () => true,
    () => false,
  );
}
