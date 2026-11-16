// What the explorer does to every selected entry at once (#313): copy and cut keep their paths in the
// explorer's own clipboard (never the system's, which Copy path writes), paste puts them in a folder as
// a drop would (drops.js: names already there ask first, one undo group for the whole paste, ADR
// 0247), and Move to Trash asks once for all of them. A folder and something inside it go as the
// folder; the explorer's own folders are never cut or trashed.
import { outermost } from "./selection.js";
import { folderOf, isUnder, nameOf, parentOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Folder} Folder
 * @typedef {{ cut: boolean, paths: string[] }} Clip
 */

const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
/** `a.md`, or `3 items`. */
const what = (/** @type {string[]} */ paths) =>
  paths.length === 1 ? nameOf(paths[0] ?? "") : `${paths.length} items`;

/**
 * @param {{ say(text: string): void, place: ReturnType<typeof import("./drops.js").createDrops>["place"],
 *   disk: ReturnType<typeof import("./disk.js").createDisk>,
 *   desk: ReturnType<typeof import("./desk.js").createDeskLink>,
 *   load(folder: string): Promise<boolean>, select(id: string | null): void, render(): void,
 *   trashOne(path: string): Promise<unknown> }} act
 * @param {{ picked(): Row[], focused(): Row | undefined, roots(): string[], rows(): Row[],
 *   expanded: Set<string>, folders: Map<string, Folder> }} state
 */
export function createMany(act, state) {
  /** @type {Clip | null} */
  let clip = null;

  /** The selected entries' paths, without what a selected folder holds; the roots only `withRoots`. */
  const chosen = (/** @type {boolean} */ withRoots) => {
    const paths = state
      .picked()
      .map((row) => row.path)
      .filter((path) => withRoots || !state.roots().includes(path));
    if (paths.length === 0) throw new Error("Select a file or folder first.");
    return outermost(paths);
  };

  const keep = (/** @type {boolean} */ cut) => {
    const paths = chosen(!cut);
    clip = { cut, paths };
    const them = paths.length === 1 ? "it" : "them";
    act.say(`${cut ? "Cut" : "Copied"} ${what(paths)}: paste ${them} in a folder.`);
    return paths;
  };

  /** Into `folder`, or the selected folder, or the folder of the selected file. */
  const paste = async (/** @type {string | undefined} */ given) => {
    if (!clip) throw new Error("Nothing to paste.");
    const folder = given ?? folderOf(state.focused()) ?? state.roots()[0];
    if (!folder) throw new Error("Select a folder to paste in.");
    const { cut, paths } = clip;
    const done = await act.place({
      paths: paths.map((path) => ({ path })),
      folder,
      effect: cut ? "move" : "copy",
      // Mod moves across volumes too, as a cut asks.
      keys: { alt: false, ctrl: false, meta: cut, shift: false },
    });
    if (cut && done !== "none") clip = null;
    return done;
  };

  /** Every selected entry to the OS trash after one question that opens on "Keep it". */
  const trash = async () => {
    const paths = chosen(false);
    if (paths.length === 1) return act.trashOne(paths[0] ?? "");
    const sure = await act.desk.confirm(
      `Move ${what(paths)} to the Trash?`,
      [
        { id: "keep", label: "Keep it", detail: "Leave them where they are" },
        {
          id: "trash",
          label: "Move to Trash",
          detail: "The desk cannot undo this; the Trash keeps them",
        },
      ],
      "trash",
    );
    if (!sure) return null;
    const at = state.rows().findIndex((row) => row.path === paths[0]);
    /** @type {string[]} */
    const gone = [];
    /** @type {unknown} */
    let failed;
    for (const path of paths) {
      try {
        await act.disk.trash(path);
        gone.push(path);
      } catch (error) {
        failed = error;
        break;
      }
    }
    for (const path of gone) {
      for (const folder of [...state.expanded])
        if (isUnder(path, folder)) state.expanded.delete(folder);
      for (const folder of [...state.folders.keys()])
        if (isUnder(path, folder)) state.folders.delete(folder);
    }
    const again = [...new Set(gone.map(parentOf))].filter(
      (folder) => folder !== undefined && state.expanded.has(folder),
    );
    if (again.length > 0) await Promise.all(again.map((folder) => act.load(folder ?? "")));
    else act.render();
    const rows = state.rows();
    act.select(rows[at]?.id ?? rows[at - 1]?.id ?? null);
    if (failed !== undefined) {
      const why = failed instanceof Error ? failed.message : String(failed);
      throw new Error(gone.length > 0 ? `Moved ${what(gone)} to the Trash. ${why}` : why);
    }
    act.say(`Moved ${what(gone)} to the Trash.`);
    return gone;
  };

  return {
    "endue.explorer.copy": () => keep(false),
    "endue.explorer.cut": () => keep(true),
    /** @param {Record<string, unknown>} a */
    "endue.explorer.paste": (a) => paste(asString(a.folder)),
    trash,
  };
}
