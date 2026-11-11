// Which files an extraction would put over others, found without asking anything: one extraction
// asks one question, for fs:write on its folder (#162 finding 15). The folder is listed under the
// read grants Archives already holds (the archive's own folder covers a folder beside it), once per
// folder, and a folder that does not exist yet holds nothing below it. A folder Archives may not
// read is written blind: fs.write keeps what each write replaces in the file's history (ADR 0076).
import { codeOf, folderOf, scopeUnder } from "./files.js";

/** @typedef {import("@endue-ai/plugin-sdk").PluginContext["bridge"]} Bridge */

/** What a folder that does not exist lists. */
const MISSING = new Set();

/** @param {Bridge} bridge @param {string} target the folder the extraction writes to */
export function createExisting(bridge, target) {
  const read = scopeUnder("fs:read", target);
  /** Names in each folder; null where Archives may not read. @type {Map<string, Promise<Set<string> | null>>} */
  const listed = new Map();
  let blind = false;

  /** @param {string} folder */
  const list = (folder) =>
    bridge.call("fs.list", { path: folder, scope: read }).then(
      ({ entries }) => new Set(entries.map((e) => e.name)),
      (error) => {
        if (codeOf(error) === "not_found") return MISSING;
        if (codeOf(error) !== "permission_denied") throw error;
        blind = true;
        return null;
      },
    );
  /** @param {string} folder */
  const names = (folder) => {
    if (!listed.has(folder)) listed.set(folder, list(folder));
    return /** @type {Promise<Set<string> | null>} */ (listed.get(folder));
  };

  return {
    /** Whether a file is at `path` already; false where Archives cannot tell. @param {string} path */
    async has(path) {
      // The folder itself first: missing, or not readable, it settles every path below it.
      const top = await names(target);
      if (top === null || top === MISSING) return false;
      const folder = folderOf(path);
      const inside = await names(folder);
      return inside?.has(path.slice(folder.length + 1)) ?? false;
    },
    /** Whether the folder could not be read, so what is there is replaced without a question. */
    get blind() {
      return blind;
    },
  };
}
