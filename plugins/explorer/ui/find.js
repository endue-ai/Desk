// Finding files by name (#313), without the DOM: the filter that narrows one folder's rows as the
// person types, and the search that walks the folders below it by name, breadth first, listing each
// folder once through the explorer's fs.list, until it has `limit` results, has listed `folders`
// folders, or is stopped. Names only: contents are never read.
import { isUnder, joinPath, order, parentOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("@endue-ai/bridge").DirEntry} DirEntry
 * @typedef {{ path: string, name: string, kind: DirEntry["kind"], folder: string }} Found
 * @typedef {{ results: Found[], stopped?: "limit" | "folders" | "cancelled" }} Search
 */

/** How many results a search lists at most, and how many folders it lists on the way. */
export const LIMIT = 1000;
export const FOLDERS = 10000;

const has = (/** @type {string} */ name, /** @type {string} */ query) =>
  name.toLocaleLowerCase().includes(query);

/**
 * The rows with `folder`'s children narrowed to those whose name holds `query`, case ignored; what is
 * open under a child that matches stays, and every row outside `folder` stays.
 * @param {Row[]} list @param {string} folder @param {string} query
 */
export function narrow(list, folder, query) {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted === "") return list;
  return list.filter((row) => {
    if (row.path === folder || !isUnder(folder, row.path)) return true;
    const below = row.path.slice(folder.length + (folder.endsWith("/") ? 0 : 1));
    return has(below.split("/")[0] ?? "", wanted);
  });
}

/**
 * Walk the folders below `folder` for entries whose name holds `query`. A folder that does not list
 * is passed over; dotfiles are left out, and dotfolders unwalked, unless they show.
 * @param {(folder: string) => Promise<DirEntry[]>} list
 * @param {string} folder @param {string} query
 * @param {{ showHidden: boolean, limit?: number, folders?: number, signal?: AbortSignal }} options
 * @returns {Promise<Search>}
 */
export async function searchBelow(list, folder, query, options) {
  const wanted = query.trim().toLocaleLowerCase();
  const limit = options.limit ?? LIMIT;
  const most = options.folders ?? FOLDERS;
  /** @type {Found[]} */
  const results = [];
  const queue = [folder];
  let listed = 0;
  while (queue.length > 0) {
    if (options.signal?.aborted) return { results, stopped: "cancelled" };
    if (listed >= most) return { results, stopped: "folders" };
    const at = /** @type {string} */ (queue.shift());
    listed++;
    /** @type {DirEntry[]} */
    let entries;
    try {
      entries = await list(at);
    } catch {
      continue;
    }
    if (options.signal?.aborted) return { results, stopped: "cancelled" };
    for (const entry of order(entries, options.showHidden)) {
      const path = joinPath(at, entry.name);
      if (entry.kind === "dir") queue.push(path);
      if (wanted === "" || !has(entry.name, wanted)) continue;
      results.push({ path, name: entry.name, kind: entry.kind, folder: parentOf(path) ?? at });
      if (results.length >= limit) return { results, stopped: "limit" };
    }
  }
  return { results };
}
