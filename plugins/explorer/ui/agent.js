// What an agent reads and moves through the explorer (ADR 0088): its folders, one folder's entries,
// files found by name below a folder, a file's text, and a move or copy into a folder. Each names its
// target by path and answers with data, so Eris works on the disk the explorer shows without the
// selection the person's commands act on. Reads go through the explorer's own fs grants (disk.js),
// which ask the person for a folder outside them; a move or copy is the drop's (drops.js), one step
// on the desk's undo stack, and a clash in the folder is asked of the person, never overwritten.
import { searchBelow } from "./find.js";
import { joinPath, normalizePath, order } from "./tree.js";

/** @typedef {import("@endue-ai/bridge").DirEntry} DirEntry */

/** How many entries a listing answers by default and at most; the same for search results. */
export const LIST = { usual: 200, most: 1000 };
export const FOUND = { usual: 50, most: 500 };
/** How many bytes of a file read answers by default and at most. */
export const READ = { usual: 16384, most: 262144 };

/** A whole number between 1 and `most`, else `usual`. */
const count = (
  /** @type {unknown} */ value,
  /** @type {{ usual: number, most: number }} */ range,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(range.most, Math.floor(value)))
    : range.usual;

/** A path an agent named, as the explorer writes paths; a relative or `..` one is refused. */
export function pathArg(/** @type {unknown} */ value, /** @type {string} */ what = "path") {
  const path = typeof value === "string" ? normalizePath(value) : undefined;
  if (path === undefined)
    throw new Error(`Name the ${what} as an absolute path or one under ~, without "..".`);
  return path;
}

/** UTF-8 text of base64 bytes, or null when they hold a NUL byte or are not UTF-8. */
function textOf(/** @type {string} */ base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.includes(0)) return { text: null, bytes: bytes.length };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), bytes: bytes.length };
  } catch {
    // A read cut through a character ends in a partial one: decode what came before it.
    const cut = new TextDecoder("utf-8").decode(bytes);
    return { text: cut.includes("�") ? null : cut, bytes: bytes.length };
  }
}

/**
 * @param {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} answer
 * @param {{ disk: ReturnType<typeof import("./disk.js").createDisk>,
 *   place(drop: import("./drops.js").Placed): Promise<"copy" | "move" | "none">,
 *   roots(): string[], showHidden(): boolean, selected(): string | null,
 *   picked(): Array<{ path: string }> }} deps
 */
export function answerAgents(answer, deps) {
  const { disk } = deps;

  answer("endue.explorer.folders", () => ({
    folders: [...deps.roots()],
    showHidden: deps.showHidden(),
    selected: deps.selected(),
    marked: deps.picked().map((row) => row.path),
  }));

  answer("endue.explorer.list", async (a) => {
    const path = pathArg(a.path ?? deps.roots()[0], "folder");
    const hidden = typeof a.hidden === "boolean" ? a.hidden : deps.showHidden();
    const limit = count(a.limit, LIST);
    const entries = order(await disk.list(path), hidden);
    return {
      path,
      entries: entries.slice(0, limit).map((/** @type {DirEntry} */ e) => ({
        name: e.name,
        path: joinPath(path, e.name),
        kind: e.kind,
        ...(e.size !== undefined ? { size: e.size } : {}),
        ...(e.modifiedAt !== undefined ? { modifiedAt: e.modifiedAt } : {}),
      })),
      total: entries.length,
      more: entries.length > limit,
    };
  });

  answer("endue.explorer.search", async (a) => {
    const query = typeof a.query === "string" ? a.query.trim() : "";
    if (query === "") throw new Error("Say what the names hold: query is empty.");
    const folder = pathArg(a.folder ?? deps.roots()[0], "folder");
    const found = await searchBelow((f) => disk.list(f), folder, query, {
      showHidden: typeof a.hidden === "boolean" ? a.hidden : deps.showHidden(),
      limit: count(a.limit, FOUND),
    });
    return {
      folder,
      query,
      results: found.results.map(({ path, name, kind }) => ({ path, name, kind })),
      stopped: found.stopped ?? null,
    };
  });

  answer("endue.explorer.read", async (a) => {
    const path = pathArg(a.path);
    const most = count(a.maxBytes, READ);
    const read = await disk.read(path, most);
    const { text, bytes } = textOf(read.content);
    const size = read.size ?? bytes;
    return { path, size, binary: text === null, text, truncated: size > bytes };
  });

  answer("endue.explorer.move", async (a) => {
    const paths = Array.isArray(a.paths) ? a.paths.map((p) => pathArg(p)) : [pathArg(a.path)];
    if (paths.length === 0) throw new Error("Name at least one path to move or copy.");
    const folder = pathArg(a.folder, "folder");
    const effect = a.copy === true ? "copy" : "move";
    const done = await deps.place({ paths: paths.map((path) => ({ path })), folder, effect });
    // "none": nothing moved, because the person kept what was there or a path cannot go there.
    return { done: done !== "none", effect: done, folder, from: paths };
  });
}
