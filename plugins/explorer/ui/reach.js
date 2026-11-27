// Reaching a path in the explorer: expanding down to it and selecting it (reveal), and the folders
// the tree starts from (add, remove), kept as the `folders` setting. A folder that cannot be listed
// does not stay a root.
import { foldersBetween, joinPath, normalizePath, patternOf } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./tree.js").Folder} Folder
 */

const NAME = "the explorer";

/**
 * @param {{ bridge: PluginContext["bridge"], desk: ReturnType<typeof import("./desk.js").createDeskLink>, surface: PluginContext["surface"],
 *   settings: PluginContext["settings"], rootOf(path: string): string | undefined,
 *   rowOf(id: string): unknown, expand(path: string): Promise<boolean>, select(id: string): void,
 *   setRoots(next: string[]): void, roots(): string[], expanded: Set<string>,
 *   folders: Map<string, Folder> }} deps
 */
export function createReach(deps) {
  const {
    bridge,
    desk,
    surface,
    settings,
    rootOf,
    rowOf,
    expand,
    select,
    setRoots,
    roots,
    expanded,
    folders,
  } = deps;
  const uncover = async (/** @type {string} */ root, /** @type {string} */ path) => {
    for (const folder of [root, ...foldersBetween(root, path)]) {
      if (!(await expand(folder))) return false;
    }
    return true;
  };

  const reveal = async (/** @type {string | undefined} */ path) => {
    const target = path ?? (await desk.inUse());
    if (!target) throw new Error("No file is in use.");
    const root = rootOf(target);
    if (!root) throw new Error(`${target} is outside ${NAME}'s folders.`);
    if (!(await uncover(root, target))) return null;
    if (!rowOf(target)) throw new Error(`${target} is not in ${root}.`);
    select(target);
    surface.show();
    return target;
  };

  const keepRoots = () => settings.set("folders", roots()).catch(() => {});

  const chooseFolder = async (/** @type {string | undefined} */ startIn) => {
    const answer = await bridge
      .call("dialog.open", {
        kind: "folders",
        intent: "destination",
        title: "Add a folder to Explorer",
        ...(startIn ? { startIn } : {}),
      })
      .catch((error) => {
        if (/** @type {{ code?: string }} */ (error)?.code !== "unsupported") throw error;
        return undefined;
      });
    if (!answer) return startIn ?? desk.pick("Add a folder", "~/path/to/folder");
    return answer.cancelled ? undefined : answer.paths[0];
  };

  const addFolder = async (/** @type {string | undefined} */ given) => {
    const typedPath = given ?? (await chooseFolder(undefined));
    if (typedPath === undefined) return null;
    const path = normalizePath(typedPath);
    if (path === undefined) throw new Error(`${typedPath} is not a folder path.`);
    if (/[*?]/u.test(path)) throw new Error("Choose an exact Explorer folder path.");
    const root = rootOf(path);
    if (root) {
      if (await uncover(root, joinPath(path, "."))) {
        select(path);
        surface.show();
      }
      return path;
    }
    if (given !== undefined) {
      const paths = [patternOf(path)];
      const held = await Promise.all(
        /** @type {const} */ (["fs:read", "fs:write"]).map((permission) =>
          bridge.call("perm.query", { permission: { permission, paths } }).then(
            ({ grants }) => grants.some((grant) => grant.duration !== "once"),
            () => false,
          ),
        ),
      );
      if (!held.every(Boolean)) {
        const chosen = await chooseFolder(path);
        if (!chosen) return null;
        if (normalizePath(chosen) !== path) throw new Error("Choose the named Explorer folder.");
      }
    }
    setRoots([...roots(), path]);
    if (!(await expand(path))) {
      // Refused or missing: a root that cannot be listed is of no use, so it does not stay.
      const why = folders.get(path)?.reason ?? `Could not list ${path}.`;
      expanded.delete(path);
      setRoots(roots().filter((root) => root !== path));
      throw new Error(why);
    }
    void keepRoots();
    select(path);
    surface.show();
    return path;
  };

  const removeFolder = (/** @type {string} */ path) => {
    if (!roots().includes(path)) throw new Error(`${path} is not one of ${NAME}'s folders.`);
    setRoots(roots().filter((root) => root !== path));
    void keepRoots();
    return [...roots()];
  };

  return { reveal, addFolder, removeFolder };
}
