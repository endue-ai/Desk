// Explorer state and commands on the public SDK: bounded previews, folder grants, file opening
// through desk.files.open, the remembered tree selection and the rows selected with it (selection.js),
// the status line (status.js), the edits on disk (edits.js, many.js) and the find bar (finding.js).
import { commandRegistry } from "./command-registry.js";
import { contextActions } from "./context-actions.js";
import { createDeskLink } from "./desk.js";
import { createDisk } from "./disk.js";
import { createDrops } from "./drops.js";
import { createEdits } from "./edits.js";
import { narrow } from "./find.js";
import { createPreview } from "./preview.js";
import { createReach } from "./reach.js";
import { createPicking, createTypeAhead, pickable } from "./selection.js";
import { statusLine } from "./status.js";
import { answerTogether } from "./together.js";
import { rows as flatten, folderList, isUnder, jump, move, nameOf } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Folder} Folder
 * @typedef {{ showHidden: boolean, folders: string[] }} Header
 * @typedef {{ tree(rows: Row[], selected: string | null, marks?: ReadonlySet<string>): void,
 *   header(header: Header): void, status(text: string): void, focus(id: string | null): void,
 *   selection?(id: string | null, marks?: ReadonlySet<string>): void,
 *   preview?(model: import("./preview.js").Preview | null): void,
 *   find?(model: import("./finding.js").FindModel | null): void }
 *   & import("./drops.js").DropView} View
 * @typedef {{ shift?: boolean, mod?: boolean }} Mods
 */

const DEFAULTS = { folders: ["~/Documents"], "show-hidden": false, page: 500 };
const STORE_KEY = "tree";

const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
const args = (/** @type {unknown} */ value) =>
  /** @type {Record<string, unknown>} */ (value && typeof value === "object" ? value : {});

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface"> & { dnd?: PluginContext["dnd"] }} ctx
 * @param {View} view
 * @param {{ debounceMs?: number }} [options]
 */
export function createExplorer({ bridge, commands, settings, surface, dnd }, view, options = {}) {
  const debounceMs = options.debounceMs ?? 100;
  /** @type {string[]} */
  let roots = [];
  /** @type {Map<string, Folder>} */
  const folders = new Map();
  /** @type {Set<string>} */
  const expanded = new Set();
  /** @type {string | null} */
  let selected = null;
  let showHidden = DEFAULTS["show-hidden"];
  let page = DEFAULTS.page;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  /** @type {Row[]} */
  let list = [];

  const status = statusLine((text) => view.status(text));
  const { say } = status;
  const rowOf = (/** @type {string | null} */ id) => list.find((row) => row.id === id);
  const picking = createPicking({ rows: () => list, say });
  /** @type {ReturnType<typeof answerTogether> | undefined} */
  let finding;
  const render = () => {
    list = flatten(roots, folders, expanded, { showHidden, page });
    const narrowing = finding?.narrowing();
    if (narrowing) list = narrow(list, narrowing.folder, narrowing.query);
    const focused = rowOf(selected) ? selected : null;
    picking.prune(focused);
    view.tree(list, focused, picking.marks());
    if (!focused) preview.close();
  };
  const header = () => view.header({ showHidden, folders: [...roots] });
  const save = () =>
    bridge
      .call("store.set", { key: STORE_KEY, value: { expanded: [...expanded], selected } })
      .catch(() => {});

  const rootOf = (/** @type {string} */ path) => roots.find((root) => isUnder(root, path));
  /**
   * List one folder; a failure shows briefly on its row and in a sentence on the status line.
   * Resolves whether it listed.
   */
  const load = async (/** @type {string} */ path) => {
    const before = folders.get(path);
    folders.set(path, { ...(before?.entries ? { entries: before.entries } : {}), loading: true });
    render();
    try {
      const entries = await disk.list(path);
      folders.set(path, { entries, ...(before?.shown ? { shown: before.shown } : {}) });
      status.listed(path);
      void disk.watch(path);
      render();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const brief = /** @type {{ brief?: string }} */ (error)?.brief ?? "could not list";
      folders.set(path, {
        ...(before?.entries ? { entries: before.entries } : {}),
        error: brief,
        reason: message,
      });
      status.failed(path, message);
      render();
      return false;
    }
  };

  const changed = (/** @type {string} */ folder) => {
    if (!expanded.has(folder)) return;
    clearTimeout(timers.get(folder));
    const reload = () => timers.delete(folder) && load(folder);
    timers.set(folder, setTimeout(reload, debounceMs));
  };
  const disk = createDisk(bridge, { rootOf, changed });
  const desk = createDeskLink(commands);
  const preview = createPreview(disk, (model) => view.preview?.(model));
  // Paths dropped on a folder move or copy there; the folders they left and reached list again.
  const drops = createDrops({ bridge, commands, dnd }, view, {
    say,
    rootOf,
    list: (folder) => disk.list(folder),
    placed: async (changed, first) => {
      if (changed[0]) expanded.add(changed[0]);
      await Promise.all(changed.filter((folder) => expanded.has(folder)).map(load));
      void save();
      if (rowOf(first)) select(first);
    },
  });

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
  const shown = () => {
    if (view.selection) view.selection(selected, picking.marks());
    else render();
    view.focus(selected);
    void preview.select(rowOf(selected));
    void save();
  };
  /** A selection that moves ends the last message: it spoke of the row before. */
  const select = (/** @type {string | null} */ id) => {
    if (id !== selected || picking.marks().size > 1) say("");
    selected = id;
    picking.only(id);
    shown();
  };
  /** A click: alone it selects; Shift extends the range from the anchor, Mod toggles the row. */
  const pick = (/** @type {string} */ id, /** @type {Mods} */ mods = {}) => {
    if (!mods.shift && !mods.mod) return select(id);
    if (!pickable(rowOf(id))) return;
    selected = id;
    picking.pick(id, mods);
    shown();
  };

  /** Open where the desk says; a file no plugin opens shows in the quick preview instead. */
  const open = async (/** @type {string} */ path) => {
    preview.close();
    try {
      await desk.open(path);
      say("");
    } catch (error) {
      const row = rowOf(path);
      if (/** @type {{ code?: string }} */ (error)?.code !== "no_opener" || !row)
        return say(error instanceof Error ? error.message : String(error));
      say(`No plugin opens ${nameOf(path)}: its preview is below.`);
      await preview.open(row);
    }
  };

  /** Enter or click: a folder opens or closes, a file opens, a "more" row shows a page. */
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

  const key = async (/** @type {string} */ name, /** @type {Mods} */ mods = {}) => {
    if (name === "Escape" && preview.active()) {
      preview.close();
      view.focus(selected);
      return true;
    }
    if (name === " " && ["file", "symlink"].includes(rowOf(selected)?.kind ?? "")) {
      await preview.toggle(rowOf(selected));
      return true;
    }
    if (name === "Enter" || name === " ") {
      if (selected !== null) await activate(selected);
      return selected !== null;
    }
    const step = move(list, selected, name);
    if (!step) return false;
    const extending = mods.shift && ["ArrowUp", "ArrowDown", "Home", "End"].includes(name);
    if (step.select !== undefined && extending && pickable(rowOf(step.select))) {
      selected = step.select;
      picking.extend(step.select);
      shown();
    } else if (step.select !== undefined) select(step.select);
    else if (step.expand !== undefined) await expand(step.expand);
    else if (step.collapse !== undefined) collapse(step.collapse);
    return true;
  };

  const typeAhead = createTypeAhead(jump);
  const type = (/** @type {string} */ letter, now = Date.now()) => {
    const id = typeAhead(list, selected, letter, now);
    if (id !== undefined) select(id);
    return id !== undefined;
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
  const { reveal, addFolder, removeFolder } = createReach({
    desk,
    surface,
    settings,
    rootOf,
    rowOf,
    expand,
    select,
    setRoots,
    roots: () => roots,
    expanded,
    folders,
  });

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

  const { command, answer } = commandRegistry(commands, say);

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
  const edits = createEdits(
    { disk, desk, say, load, select, render, reveal, open },
    { expanded, folders, rows: () => list, selected: () => selected, roots: () => roots },
  );
  // Move to Trash is answered with the selection's commands (together.js).
  for (const [id, run] of Object.entries(edits)) if (id !== "endue.explorer.trash") answer(id, run);
  finding = answerTogether(answer, {
    say,
    place: drops.place,
    disk,
    desk,
    load,
    select,
    shown,
    render,
    open,
    reveal,
    picking,
    trashOne: (a) => edits["endue.explorer.trash"](a),
    focused: () => rowOf(selected),
    roots: () => roots,
    rows: () => list,
    showHidden: () => showHidden,
    show: (model) => view.find?.(model),
    expanded,
    folders,
  });
  const context = contextActions(bridge, commands, {
    selected: () => rowOf(selected),
    say,
    open: async (row) => {
      if (row.kind !== "dir") return open(row.path);
      preview.close();
      return expand(row.path);
    },
  });
  for (const [id, action] of Object.entries(context)) answer(id, action);

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
    expanded.clear();
    for (const folder of folderList(saved.expanded) ?? []) if (rootOf(folder)) expanded.add(folder);
    if (expanded.size === 0 && roots[0]) expanded.add(roots[0]);
    selected = asString(saved.selected) ?? null;
    header();
    render();
    await Promise.all([...expanded].map(load));
    render();
  };

  const dispose = () => {
    preview.close();
    for (const timer of timers.values()) clearTimeout(timer);
  };
  return {
    start,
    select,
    pick,
    activate,
    key,
    togglePreview: () => preview.toggle(rowOf(selected)),
    type,
    command,
    addFolder,
    removeFolder,
    reveal,
    filter: (/** @type {string} */ query) => finding?.filter(query, undefined),
    searchBelow: (/** @type {string} */ query) => finding?.below(query, undefined),
    stopFind: () => finding?.stop(),
    closeFind: () => finding?.close(),
    openFound: (/** @type {string} */ path) => finding?.openFound(path),
    revealFound: (/** @type {string} */ path) => finding?.revealFound(path),
    dispose,
  };
}
