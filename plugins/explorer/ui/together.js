// The explorer's commands for several entries and for finding them (#313): copy, cut, paste, select
// all and Move to Trash of the selection (many.js), and the find bar's narrowing and search below
// (finding.js). Answers them on the registry and hands back the find bar, which the tree reads.
import { createFinding } from "./finding.js";
import { createMany } from "./many.js";
import { folderOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Folder} Folder
 */

const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * @param {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} answer
 * @param {Parameters<typeof createMany>[0] & {
 *   shown(): void, open(path: string): Promise<unknown>, reveal(path: string): Promise<unknown>,
 *   picking: ReturnType<typeof import("./selection.js").createPicking>,
 *   trashOne(a: Record<string, unknown>): Promise<unknown>,
 *   focused(): Row | undefined, roots(): string[], rows(): Row[], showHidden(): boolean,
 *   show?(model: import("./finding.js").FindModel | null): void,
 *   expanded: Set<string>, folders: Map<string, Folder> }} deps
 */
export function answerTogether(answer, deps) {
  const { picking } = deps;
  const { trash, ...many } = createMany(
    { ...deps, trashOne: (path) => deps.trashOne({ path }) },
    {
      picked: picking.picked,
      focused: deps.focused,
      roots: deps.roots,
      rows: deps.rows,
      expanded: deps.expanded,
      folders: deps.folders,
    },
  );
  for (const [id, run] of Object.entries(many)) answer(id, run);
  // Move to Trash takes the selection when several rows are selected and no path is named.
  answer("endue.explorer.trash", (a) =>
    asString(a.path) === undefined && picking.picked().length > 1 ? trash() : deps.trashOne(a),
  );
  answer("endue.explorer.select-all", () => {
    const count = picking.all();
    deps.shown();
    return count;
  });

  const finding = createFinding(
    {
      list: (folder) => deps.disk.list(folder),
      say: deps.say,
      render: deps.render,
      open: deps.open,
      reveal: deps.reveal,
      show: (model) => deps.show?.(model),
    },
    {
      folder: () => folderOf(deps.focused()) ?? deps.roots()[0],
      showHidden: deps.showHidden,
    },
  );
  const query = (/** @type {unknown} */ value) => (typeof value === "string" ? value : undefined);
  answer("endue.explorer.find", (a) => finding.open(query(a.query)));
  answer("endue.explorer.find-below", (a) => finding.below(query(a.query) ?? "", undefined));
  return finding;
}
