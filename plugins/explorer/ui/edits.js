// What the explorer changes on disk (ADR 0125): New file, New folder, Rename and Move to Trash. Each
// asks one question in the palette (docs/ko/explorer-requirements.md): a name, typed from the old one
// for a rename, or whether to trash, every time, since the desk cannot undo a trash. A name is checked
// against a fresh listing of its folder first and never overwrites. Each change is one bridge call, so
// the core keeps a rename and a new folder on the desk's undo stack, and the OS trash keeps what is
// trashed. The explorer's own folders are neither renamed nor trashed here.
import { folderOf, isUnder, joinPath, nameOf, parentOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Folder} Folder
 * @typedef {{ folder?: string, name?: string }} Making
 */

const NAME = "the explorer";

const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
/** A name inside a folder: no separator or NUL, not `.` or `..`. */
const plain = (/** @type {string} */ name) =>
  !/[/\\\0]/.test(name) && name !== "." && name !== "..";

/**
 * @param {{ disk: ReturnType<typeof import("./disk.js").createDisk>,
 *   desk: ReturnType<typeof import("./desk.js").createDeskLink>, say(text: string): void,
 *   load(folder: string): Promise<boolean>, select(id: string | null): void, render(): void,
 *   reveal(path: string): Promise<string | null>, open(path: string): Promise<unknown> }} act
 * @param {{ expanded: Set<string>, folders: Map<string, Folder>, rows(): Row[],
 *   selected(): string | null, roots(): string[] }} state
 */
export function createEdits(act, state) {
  const { disk, desk, say } = act;
  const rowOf = (/** @type {string | null} */ id) => state.rows().find((row) => row.id === id);

  /** The entry a command acts on: `path`, revealed and selected first, or the selection. */
  const entry = async (/** @type {string | undefined} */ path) => {
    if (path !== undefined && !(await act.reveal(path))) return undefined;
    const row = rowOf(path ?? state.selected());
    if (!row || row.kind === "more") throw new Error("Select a file or folder first.");
    if (state.roots().includes(row.path))
      throw new Error(
        `${row.path} is one of ${NAME}'s folders; it is not renamed or trashed here.`,
      );
    return row;
  };

  /** The entries of `folder`, listed afresh and shown; undefined when it could not be listed. */
  const listed = async (/** @type {string} */ folder) => {
    state.expanded.add(folder);
    return (await act.load(folder)) ? (state.folders.get(folder)?.entries ?? []) : undefined;
  };

  /** Expanded folders and listings at or under `from` move to `to`, or are forgotten without it. */
  const retarget = (/** @type {string} */ from, /** @type {string | undefined} */ to) => {
    const moved = (/** @type {string} */ path) =>
      to === undefined ? undefined : to + path.slice(from.length);
    for (const path of [...state.expanded].filter((p) => isUnder(from, p))) {
      state.expanded.delete(path);
      const next = moved(path);
      if (next !== undefined) state.expanded.add(next);
    }
    for (const [path, folder] of [...state.folders].filter(([p]) => isUnder(from, p))) {
      state.folders.delete(path);
      const next = moved(path);
      if (next !== undefined) state.folders.set(next, folder);
    }
  };

  /** A new or renamed entry: its folder (and itself, when open) listed again, and selected. */
  const placed = async (/** @type {string} */ path, /** @type {string | undefined} */ from) => {
    if (from !== undefined) retarget(from, path);
    const again = [parentOf(path), ...(state.expanded.has(path) ? [path] : [])];
    await Promise.all(again.filter((f) => f !== undefined).map(act.load));
    act.select(path);
  };

  /** A new empty file (opened) or folder in `wanted.folder`, or where the selection is. */
  const make = async (/** @type {"file" | "folder"} */ kind, /** @type {Making} */ wanted) => {
    const folder = wanted.folder ?? folderOf(rowOf(state.selected())) ?? state.roots()[0];
    if (!folder) throw new Error(`Add a folder to ${NAME} first.`);
    const placeholder = kind === "file" ? "name.md" : "New folder";
    const name = wanted.name ?? (await desk.pick(`New ${kind} in ${folder}`, placeholder));
    if (name === undefined) return null;
    if (!plain(name)) throw new Error(`${name} is not a ${kind} name.`);
    const path = joinPath(folder, name);
    const entries = await listed(folder);
    if (!entries) return null;
    if (entries.some((e) => e.name === name)) throw new Error(`${path} already exists.`);
    await (kind === "file" ? disk.create(path) : disk.mkdir(path));
    say("");
    await placed(path, undefined);
    if (kind === "file") await act.open(path);
    else say(`Made the folder ${name} in ${nameOf(folder)}.`);
    return path;
  };

  /** A new name in the same folder; moving to another folder is a drop (drops.js). */
  const rename = async (/** @type {{ path?: string, name?: string }} */ wanted) => {
    const row = await entry(wanted.path);
    const folder = row && parentOf(row.path);
    if (!row || folder === undefined) return null;
    const name = wanted.name ?? (await desk.pick(`Rename ${row.name}`, row.name, row.name));
    if (name === undefined || name === row.name) return null;
    if (!plain(name))
      throw new Error(`${name} is not a ${row.kind === "dir" ? "folder" : "file"} name.`);
    const entries = await listed(folder);
    if (!entries) return null;
    if (entries.some((e) => e.name === name))
      throw new Error(`${name} is already in ${nameOf(folder)}.`);
    const to = joinPath(folder, name);
    await disk.rename(row.path, to);
    await placed(to, row.path);
    say(`Renamed ${row.name} to ${name}.`);
    return to;
  };

  /** To the OS trash after one question; the next row is selected, or the one before the last. */
  const trash = async (/** @type {{ path?: string }} */ wanted) => {
    const row = await entry(wanted.path);
    if (!row) return null;
    const what = row.kind === "dir" ? `${row.name} and everything in it` : row.name;
    const sure = await desk.confirm(`Move ${what} to the Trash?`, [
      {
        id: "trash",
        label: "Move to Trash",
        detail: "The desk cannot undo this; the Trash keeps it",
      },
      { id: "keep", label: "Keep it", detail: `Leave ${row.name} where it is` },
    ]);
    if (!sure) return null;
    const at = state.rows().findIndex((r) => r.id === row.id);
    try {
      await disk.trash(row.path);
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== "unsupported") throw error;
      throw new Error(`There is no Trash here: ${row.name} stays where it is.`);
    }
    retarget(row.path, undefined);
    const folder = parentOf(row.path);
    if (folder !== undefined && state.expanded.has(folder)) await act.load(folder);
    else act.render();
    const rows = state.rows();
    act.select(rows[at]?.id ?? rows[at - 1]?.id ?? null);
    say(`Moved ${row.name} to the Trash.`);
    return row.path;
  };

  /** @param {Record<string, unknown>} a */
  const making = (a) => ({ folder: asString(a.folder), name: asString(a.name) });
  return {
    /** @param {Record<string, unknown>} a */
    "endue.explorer.new-file": (a) => make("file", making(a)),
    /** @param {Record<string, unknown>} a */
    "endue.explorer.new-folder": (a) => make("folder", making(a)),
    /** @param {Record<string, unknown>} a */
    "endue.explorer.rename": (a) => rename({ path: asString(a.path), name: asString(a.name) }),
    /** @param {Record<string, unknown>} a */
    "endue.explorer.trash": (a) => trash({ path: asString(a.path) }),
  };
}
