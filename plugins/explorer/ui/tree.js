// The explorer's tree without its DOM or the bridge: bridge paths, the order a folder's entries are
// shown in, the rows on screen for the folders that are expanded, and where a key moves the
// selection. Everything here is a pure function, so the tests run it in Node.

/**
 * @typedef {import("@endue-ai/bridge").DirEntry} DirEntry
 * @typedef {"file" | "dir" | "symlink"} EntryKind
 * @typedef {{ entries?: DirEntry[], loading?: boolean, error?: string, shown?: number }} Folder
 * One folder the explorer listed: its entries, or why it has none yet; `shown` is how many entries
 * the person asked to see past the page.
 * @typedef {{
 *   id: string, path: string, name: string, kind: EntryKind | "more", depth: number, root: string,
 *   hidden: boolean, expanded?: boolean, loading?: boolean, error?: string, size?: number,
 *   more?: number,
 * }} Row
 * One row on screen. `id` is the path for an entry and `more:<folder>` for a folder's "more" row.
 */

/** The last segment of a bridge path; a root (`~`, `/`, `C:/`) is its own name. */
export function nameOf(path) {
  if (isRoot(path)) return path;
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `~`, `/`, `C:/` and `${...}`: paths with no parent. */
export function isRoot(path) {
  return path === "~" || path === "/" || /^[A-Za-z]:\/$/.test(path) || /^\$\{[a-z]+\}$/.test(path);
}

/** The folder a path is in, or undefined for a root. */
export function parentOf(path) {
  if (isRoot(path)) return undefined;
  const slash = path.lastIndexOf("/");
  if (slash < 0) return undefined;
  const parent = path.slice(0, slash);
  if (parent === "" || parent.endsWith(":")) return `${parent}/`;
  return parent;
}

export function joinPath(folder, name) {
  return folder.endsWith("/") ? `${folder}${name}` : `${folder}/${name}`;
}

/** Whether `path` is `folder` or inside it. */
export function isUnder(folder, path) {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

/** The folders from `folder` (exclusive) down to the one holding `path` (inclusive), top first. */
export function foldersBetween(folder, path) {
  const out = [];
  let at = parentOf(path);
  while (at !== undefined && at !== folder && isUnder(folder, at)) {
    out.unshift(at);
    at = parentOf(at);
  }
  return out;
}

/** The `fs:*` pattern that covers everything under a folder. */
export function patternOf(folder) {
  return folder.endsWith("/") ? `${folder}**` : `${folder}/**`;
}

/** A path typed by the person, as the bridge wants it: forward slashes, no trailing slash. */
export function normalizePath(typed) {
  let path = typed.trim().replace(/\\/g, "/");
  if (path === "") return undefined;
  while (path.length > 1 && path.endsWith("/") && !/^[A-Za-z]:\/$/.test(path)) {
    path = path.slice(0, -1);
  }
  if (!/^(\/|~(\/|$)|[A-Za-z]:\/|\$\{(plugin|workspace|home)\}(\/|$))/.test(path)) return undefined;
  if (path.split("/").some((segment) => segment === "..")) return undefined;
  return path;
}

export const isHidden = (name) => name.startsWith(".");

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const rank = (/** @type {EntryKind} */ kind) => (kind === "dir" ? 0 : 1);

/**
 * Folders first, then files and links, each in natural order (`a2` before `a10`), case ignored;
 * entries whose names differ only by case keep a fixed order. Dotfiles are left out unless asked.
 * @param {DirEntry[]} entries
 * @param {boolean} showHidden
 */
export function order(entries, showHidden) {
  return entries
    .filter((entry) => showHidden || !isHidden(entry.name))
    .sort(
      (a, b) =>
        rank(a.kind) - rank(b.kind) ||
        collator.compare(a.name, b.name) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

/**
 * The rows on screen: every root, and under each expanded folder its entries, a page at a time.
 * @param {string[]} roots
 * @param {ReadonlyMap<string, Folder>} folders
 * @param {ReadonlySet<string>} expanded
 * @param {{ showHidden: boolean, page: number }} options
 * @returns {Row[]}
 */
export function rows(roots, folders, expanded, options) {
  /** @type {Row[]} */
  const out = [];
  const walk = (/** @type {string} */ path, /** @type {string} */ name, depth, root) => {
    const folder = folders.get(path);
    const open = expanded.has(path);
    out.push({
      id: path,
      path,
      name,
      kind: "dir",
      depth,
      root,
      hidden: isHidden(name),
      expanded: open,
      loading: folder?.loading === true,
      ...(folder?.error ? { error: folder.error } : {}),
    });
    if (!open || !folder?.entries) return;
    const list = order(folder.entries, options.showHidden);
    const limit = Math.max(1, folder.shown ?? options.page);
    for (const entry of list.slice(0, limit)) {
      const child = joinPath(path, entry.name);
      if (entry.kind === "dir") walk(child, entry.name, depth + 1, root);
      else
        out.push({
          id: child,
          path: child,
          name: entry.name,
          kind: entry.kind,
          depth: depth + 1,
          root,
          hidden: isHidden(entry.name),
          ...(entry.size === undefined ? {} : { size: entry.size }),
        });
    }
    if (list.length > limit) {
      out.push({
        id: `more:${path}`,
        path,
        name: `${list.length - limit} more`,
        kind: "more",
        depth: depth + 1,
        root,
        hidden: false,
        more: list.length - limit,
      });
    }
  };
  for (const root of roots) walk(root, nameOf(root), 0, root);
  return out;
}

/**
 * Where a key moves the selection, as the WAI-ARIA tree pattern says. Returns the row to select,
 * or a folder to expand or collapse, or nothing when the key is not the tree's.
 * @param {Row[]} list
 * @param {string | null} selected
 * @param {string} key
 * @returns {{ select?: string, expand?: string, collapse?: string } | undefined}
 */
export function move(list, selected, key) {
  if (list.length === 0) return undefined;
  const at = list.findIndex((row) => row.id === selected);
  const current = at < 0 ? undefined : list[at];
  const first = list[0];
  const last = list[list.length - 1];
  switch (key) {
    case "ArrowDown":
      return { select: (at < 0 ? first : (list[at + 1] ?? current))?.id };
    case "ArrowUp":
      return { select: (at < 0 ? first : (list[at - 1] ?? current))?.id };
    case "Home":
      return { select: first?.id };
    case "End":
      return { select: last?.id };
    case "ArrowRight": {
      if (!current) return { select: first?.id };
      if (current.kind !== "dir") return {};
      if (!current.expanded) return { expand: current.path };
      const child = list[at + 1];
      return child && child.depth === current.depth + 1 ? { select: child.id } : {};
    }
    case "ArrowLeft": {
      if (!current) return { select: first?.id };
      if (current.kind === "dir" && current.expanded) return { collapse: current.path };
      for (let i = at - 1; i >= 0; i--) {
        const row = list[i];
        if (row && row.depth === current.depth - 1) return { select: row.id };
      }
      return {};
    }
    default:
      return undefined;
  }
}

/** Type-ahead: the next row after the selection whose name starts with the letters, wrapping. */
export function jump(list, selected, letters) {
  const wanted = letters.toLocaleLowerCase();
  if (wanted === "" || list.length === 0) return undefined;
  const at = list.findIndex((row) => row.id === selected);
  for (let step = 1; step <= list.length; step++) {
    const row = list[(at + step) % list.length];
    if (row && row.kind !== "more" && row.name.toLocaleLowerCase().startsWith(wanted))
      return row.id;
  }
  return undefined;
}

/** A list of folder paths from a setting or the store, normalised, without duplicates. */
export function folderList(/** @type {unknown} */ value) {
  if (!Array.isArray(value)) return undefined;
  const paths = value.map((v) => (typeof v === "string" ? normalizePath(v) : undefined));
  return [...new Set(paths)].filter((v) => v !== undefined);
}

/** The folder a row refers to, or the parent of a selected file. */
export function folderOf(/** @type {Row | undefined} */ row) {
  return row
    ? row.kind === "dir" || row.kind === "more"
      ? row.path
      : parentOf(row.path)
    : undefined;
}
