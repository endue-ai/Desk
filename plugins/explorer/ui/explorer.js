// The explorer without its DOM: the tree's state and its commands. It lists the folders the person
// allows (disk.js: fs.list with one ask on a refusal, fs.watch), a page at a time, opens a file
// through the desk (desk.js: desk.files.open, so the plugin that owns the file type reads it under its
// own grants), and keeps the expanded folders and the selection in the store. It talks only to
// ctx.bridge, ctx.commands, ctx.settings, ctx.surface and a view, so the SDK's test host runs it.
import { createDeskLink } from "./desk.js";
import { createDisk } from "./disk.js";
import {
  rows as flatten,
  foldersBetween,
  isUnder,
  joinPath,
  jump,
  move,
  normalizePath,
  parentOf,
} from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Folder} Folder
 * @typedef {{ showHidden: boolean, folders: string[] }} Header
 * @typedef {{ tree(rows: Row[], selected: string | null): void, header(header: Header): void,
 *   status(text: string): void, focus(id: string | null): void }} View
 */

/** The defaults of plugin.json's contributes.settings, for a core that has none set. */
const DEFAULTS = { folders: ["~/Documents"], "show-hidden": false, page: 500 };
const STORE_KEY = "tree";
const NAME = "the explorer";

const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
const args = (/** @type {unknown} */ value) =>
  /** @type {Record<string, unknown>} */ (value && typeof value === "object" ? value : {});

/** A list of folder paths from a setting or the store, normalised, without duplicates. */
const folderList = (/** @type {unknown} */ value) => {
  if (!Array.isArray(value)) return undefined;
  const paths = value.map((v) => (typeof v === "string" ? normalizePath(v) : undefined));
  return [...new Set(paths)].filter((v) => v !== undefined);
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface">} ctx
 * @param {View} view
 * @param {{ debounceMs?: number }} [options]
 */
export function createExplorer({ bridge, commands, settings, surface }, view, options = {}) {
  const debounceMs = options.debounceMs ?? 100;
  /** @type {string[]} */
  let roots = [];
  /** @type {Map<string, Folder>} */
  const folders = new Map();
  /** @type {Set<string>} */
  let expanded = new Set();
  /** @type {string | null} */
  let selected = null;
  let showHidden = DEFAULTS["show-hidden"];
  let page = DEFAULTS.page;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  /** @type {Row[]} */
  let list = [];
  let said = "";
  let typed = "";
  let typedAt = 0;

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const rowOf = (/** @type {string | null} */ id) => list.find((row) => row.id === id);
  /** The selection stays through a listing; the view sees it once its row is there. */
  const render = () => {
    list = flatten(roots, folders, expanded, { showHidden, page });
    view.tree(list, rowOf(selected) ? selected : null);
  };
  const header = () => view.header({ showHidden, folders: [...roots] });
  const save = () =>
    bridge
      .call("store.set", { key: STORE_KEY, value: { expanded: [...expanded], selected } })
      .catch(() => {});

  const rootOf = (/** @type {string} */ path) => roots.find((root) => isUnder(root, path));
  /** List one folder; a failure shows on its row and the status line. Resolves whether it listed. */
  const load = async (/** @type {string} */ path) => {
    const before = folders.get(path);
    folders.set(path, { ...(before?.entries ? { entries: before.entries } : {}), loading: true });
    render();
    try {
      const entries = await disk.list(path);
      folders.set(path, { entries, ...(before?.shown ? { shown: before.shown } : {}) });
      say("");
      void disk.watch(path);
      render();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      folders.set(path, {
        ...(before?.entries ? { entries: before.entries } : {}),
        error: message,
      });
      say(message);
      render();
      return false;
    }
  };

  /** A change under a watched, expanded folder lists it again, once the burst is over. */
  const changed = (/** @type {string} */ folder) => {
    if (!expanded.has(folder)) return;
    clearTimeout(timers.get(folder));
    const reload = () => timers.delete(folder) && load(folder);
    timers.set(folder, setTimeout(reload, debounceMs));
  };
  const disk = createDisk(bridge, { rootOf, changed });
  const desk = createDeskLink(commands);

  const expand = async (/** @type {string} */ path) => {
    if (!expanded.has(path)) {
      expanded.add(path);
      void save();
    }
    if (folders.get(path)?.entries) {
      render();
      return true;
    }
    return load(path);
  };
  const collapse = (/** @type {string} */ path) => {
    if (!expanded.delete(path)) return;
    render();
    void save();
  };
  const select = (/** @type {string | null} */ id) => {
    selected = id;
    render();
    view.focus(selected);
    void save();
  };

  const open = (/** @type {string} */ path) =>
    desk.open(path).then(
      () => say(""),
      (error) => say(error.message),
    );

  /** Enter, Space or a click: a folder opens or closes, a file opens, a "more" row shows a page. */
  const activate = async (/** @type {string} */ id) => {
    const row = rowOf(id);
    if (!row) return;
    if (row.kind === "more") {
      const folder = folders.get(row.path);
      const index = list.indexOf(row);
      if (folder) folder.shown = (folder.shown ?? page) + page;
      render();
      select(list[index]?.id ?? list[list.length - 1]?.id ?? null);
    } else if (row.kind === "dir") {
      if (row.expanded) collapse(row.path);
      else await expand(row.path);
    } else {
      await open(row.path);
    }
  };

  /** A key pressed on the tree; resolves whether the tree used it. */
  const key = async (/** @type {string} */ name) => {
    if (name === "Enter" || name === " ") {
      if (selected !== null) await activate(selected);
      return selected !== null;
    }
    const step = move(list, selected, name);
    if (!step) return false;
    if (step.select !== undefined) select(step.select);
    else if (step.expand !== undefined) await expand(step.expand);
    else if (step.collapse !== undefined) collapse(step.collapse);
    return true;
  };

  /** Type-ahead: letters typed within a moment select the next row that starts with them. */
  const type = (/** @type {string} */ letter, now = Date.now()) => {
    typed = now - typedAt < 700 ? typed + letter : letter;
    typedAt = now;
    let id = jump(list, selected, typed);
    if (id === undefined && typed !== letter) {
      typed = letter;
      id = jump(list, selected, letter);
    }
    if (id !== undefined) select(id);
    return id !== undefined;
  };

  /** Expand every folder from the root down to the one holding `path`; false when one failed. */
  const uncover = async (/** @type {string} */ root, /** @type {string} */ path) => {
    for (const folder of [root, ...foldersBetween(root, path)]) {
      if (!(await expand(folder))) return false;
    }
    return true;
  };

  /** Show a file in the tree: the one named, or the one in use. */
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

  const setRoots = (/** @type {string[]} */ next) => {
    if (next.length === roots.length && next.every((root, i) => root === roots[i])) return;
    roots = next;
    for (const folder of [...expanded]) if (!rootOf(folder)) expanded.delete(folder);
    for (const folder of [...folders.keys()]) if (!rootOf(folder)) folders.delete(folder);
    header();
    render();
    void save();
  };
  const keepRoots = () => settings.set("folders", roots).catch(() => {});

  /** Add a folder to the tree, asked for in the palette when none is given, and list it. */
  const addFolder = async (/** @type {string | undefined} */ given) => {
    const typedPath = given ?? (await desk.pick("Add a folder", "~/path/to/folder"));
    if (typedPath === undefined) return null;
    const path = normalizePath(typedPath);
    if (path === undefined) throw new Error(`${typedPath} is not a folder path.`);
    const root = rootOf(path);
    if (root) {
      if (await uncover(root, joinPath(path, "."))) {
        select(path);
        surface.show();
      }
      return path;
    }
    setRoots([...roots, path]);
    void keepRoots();
    if (await expand(path)) {
      select(path);
      surface.show();
    }
    return path;
  };

  const removeFolder = (/** @type {string} */ path) => {
    if (!roots.includes(path)) throw new Error(`${path} is not one of ${NAME}'s folders.`);
    setRoots(roots.filter((root) => root !== path));
    void keepRoots();
    return [...roots];
  };

  /** The folder a new file goes in: the selected folder, the selected file's, or the first root. */
  const selectedFolder = () => {
    const row = rowOf(selected);
    if (!row) return roots[0];
    return row.kind === "dir" || row.kind === "more" ? row.path : parentOf(row.path);
  };

  /** Create an empty file and open it. The folder is listed again first, so nothing is overwritten. */
  const newFile = async (/** @type {{ folder?: string, name?: string }} */ wanted) => {
    const folder = wanted.folder ?? selectedFolder();
    if (!folder) throw new Error(`Add a folder to ${NAME} first.`);
    const name = wanted.name ?? (await desk.pick(`New file in ${folder}`, "name.md"));
    if (name === undefined) return null;
    if (/[/\\]/.test(name) || name === "." || name === "..") {
      throw new Error(`${name} is not a file name.`);
    }
    const path = joinPath(folder, name);
    expanded.add(folder);
    if (!(await load(folder))) return null;
    if (folders.get(folder)?.entries?.some((entry) => entry.name === name)) {
      throw new Error(`${path} already exists.`);
    }
    await disk.create(path);
    say("");
    await load(folder);
    select(path);
    await open(path);
    return path;
  };

  const setHidden = (/** @type {boolean} */ value) => {
    if (showHidden === value) return;
    showHidden = value;
    header();
    render();
    void settings.set("show-hidden", value).catch(() => {});
  };

  const refresh = async (/** @type {string | undefined} */ path) => {
    const targets = path ? [path] : [...expanded];
    await Promise.all(targets.map(load));
  };

  settings.onChange(({ key: name, value }) => {
    if (name === "show-hidden" && typeof value === "boolean") setHidden(value);
    const next = name === "folders" ? folderList(value) : undefined;
    if (next) setRoots(next);
  });

  /** @type {Map<string, (args: Record<string, unknown>) => unknown>} */
  const own = new Map();
  /**
   * Run one of the plugin's commands, from the desk (cmd.invoked) or its own tools. A failure goes
   * to the status line and ends the command with the same words, which the desk shows in its notice.
   * @param {string} name
   * @param {unknown} raw
   */
  const command = async (name, raw) => {
    const handler = own.get(name);
    if (!handler) throw new Error(`${NAME} has no command ${name}.`);
    try {
      return await handler(args(raw));
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  /** @type {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} */
  const answer = (name, handler) => {
    own.set(name, handler);
    commands.on(name, (raw) => command(name, raw));
  };

  answer("endue.explorer.open", () => {
    if (!rowOf(selected) && list[0]) selected = list[0].id;
    surface.show();
    render();
    view.focus(selected);
    return selected;
  });
  answer("endue.explorer.reveal", (a) => reveal(asString(a.path)));
  answer("endue.explorer.refresh", (a) => refresh(asString(a.path)));
  answer("endue.explorer.toggle-hidden", (a) => {
    setHidden(typeof a.show === "boolean" ? a.show : !showHidden);
    return showHidden;
  });
  answer("endue.explorer.add-folder", (a) => addFolder(asString(a.path)));
  answer("endue.explorer.remove-folder", (a) => {
    const path = asString(a.path) ?? rowOf(selected)?.root;
    if (!path) throw new Error("Select a folder to remove.");
    return removeFolder(path);
  });
  answer("endue.explorer.new-file", (a) =>
    newFile({ folder: asString(a.folder), name: asString(a.name) }),
  );

  /** Read the settings and the saved tree, show it, and list the folders that were expanded. */
  const start = async () => {
    const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
    const setting = async (/** @type {keyof typeof DEFAULTS} */ name) =>
      (await settings.get(name).catch(() => undefined)) ??
      /** @type {Record<string, unknown> | undefined} */ (init.settings)?.[
        `endue.explorer.${name}`
      ] ??
      DEFAULTS[name];
    roots = folderList(await setting("folders")) ?? [...DEFAULTS.folders];
    showHidden = (await setting("show-hidden")) === true;
    const size = Number(await setting("page"));
    page = Number.isInteger(size) && size > 0 ? size : DEFAULTS.page;
    const stored = await bridge.call("store.get", { key: STORE_KEY }).catch(() => ({}));
    const saved = args(/** @type {{ value?: unknown }} */ (stored).value);
    expanded = new Set((folderList(saved.expanded) ?? []).filter((folder) => rootOf(folder)));
    if (expanded.size === 0 && roots[0]) expanded.add(roots[0]);
    selected = asString(saved.selected) ?? null;
    header();
    render();
    await Promise.all([...expanded].map(load));
    render();
  };

  return { start, select, activate, key, type, command, addFolder, removeFolder, newFile, reveal };
}
