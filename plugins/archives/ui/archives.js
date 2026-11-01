// The archives plugin without its DOM. It answers the desk's file and buffer requests for the files
// it holds, opens each with ranged reads, keeps one tree per archive level (an archive inside one
// opens a level down), previews the selected entry and runs extractions. It only talks to
// ctx.commands, ctx.bridge and a view, so the SDK's test host runs it with a recording view.

import { formatSize } from "./bytes.js";
import { createExtractor, WRITE_LIMIT } from "./extract.js";
import { createFiles, folderOf, nameOf } from "./files.js";
import { ENCRYPTED } from "./formats/archive.js";
import { detectFormat, openDetected } from "./formats/index.js";
import { HEX_LIMIT, previewOf, TEXT_LIMIT } from "./preview.js";
import { memorySource } from "./source.js";
import { buildTree, entriesUnder, visibleRows } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Detail} Detail
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Sort} Sort
 * @typedef {import("./preview.js").PreviewModel} PreviewModel
 * @typedef {import("./source.js").Source} Source
 * @typedef {{
 *   buffer: string, path: string, name: string, format: string, size: number, levels: string[],
 *   details: Detail[], note?: string, refusal?: string, rows: Row[], summary: string,
 *   sort: Sort, filter: string, selected: string | null, extracting: boolean,
 * }} ArchiveModel
 * @typedef {{
 *   archive(model: ArchiveModel | null): void, preview(model: PreviewModel | null): void,
 *   status(text: string): void, progress(text: string): void, focus(): void,
 * }} View
 * @typedef {{ name: string, format: string, archive?: Archive, note?: string,
 *   tree: ReturnType<typeof buildTree>, expanded: Set<string>, marked: Set<string>,
 *   selected: string | null }} Level
 * @typedef {{ buffer: string, path: string, name: string, size: number, levels: Level[], watchId?: string }} Held
 */

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};
const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** A level for an opened archive, or for a file shown as details only. @param {string} name @param {string} format @param {Archive} [archive] @param {string} [note] */
function level(name, format, archive, note) {
  const tree = buildTree(archive?.entries ?? []);
  /** @type {Level} */
  const made = { name, format, tree, expanded: new Set(), marked: new Set(), selected: null };
  // A lone folder at the top (a project folder, usr/share/doc/...) opens, down to where it branches.
  for (let node = tree.root; node.children.length === 1 && node.children[0]?.kind === "folder"; ) {
    node = /** @type {typeof node} */ (node.children[0]);
    made.expanded.add(node.id);
  }
  if (archive) made.archive = archive;
  const why = note ?? archive?.note;
  if (why) made.note = why;
  return made;
}

/** Open `source` as whatever it is; a file this plugin cannot show becomes a details level. @param {Source} source @param {string} name */
async function openLevel(source, name) {
  const kind = await detectFormat(source, name).catch(() => null);
  if (!kind)
    return level(
      name,
      "Unknown",
      undefined,
      "This is not an archive, package or disk image that Archives reads.",
    );
  try {
    const archive = await openDetected(source, name, kind);
    return level(name, archive.format, archive);
  } catch (error) {
    const why = message(error);
    return level(name, kind.label, undefined, /\.$/.test(why) ? why : `${why}.`);
  }
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 */
export function createArchives({ bridge, commands }, view) {
  const files = createFiles(bridge);
  /** @type {Map<string, Held>} */
  const held = new Map();
  /** @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  /** @type {Sort} */
  let sort = { by: "name", descending: false };
  let filter = "";
  let said = "";
  let previewed = 0;

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const extractor = createExtractor({ bridge, commands }, files, {
    say,
    progress: (text) => view.progress(text),
  });

  const current = () => (shown === null ? undefined : held.get(shown));
  const top = () => current()?.levels.at(-1);

  const render = () => {
    const file = current();
    const at = top();
    if (!file || !at) return view.archive(null);
    const { rows, summary } = visibleRows(at.tree.root, {
      expanded: at.expanded,
      marked: at.marked,
      sort,
      filter,
    });
    if (at.selected === null || !rows.some((r) => r.id === at.selected))
      at.selected = rows[0]?.id ?? null;
    /** @type {ArchiveModel} */
    const model = {
      buffer: file.buffer,
      path: file.path,
      name: file.name,
      format: at.format,
      size: file.size,
      levels: file.levels.map((l) => l.name),
      details: at.archive?.details ?? [],
      rows: at.archive ? rows : [],
      summary: at.archive ? summary : "",
      sort,
      filter,
      selected: at.archive ? at.selected : null,
      extracting: extractor.running,
    };
    if (at.note) model.note = at.note;
    if (at.archive?.refusal) model.refusal = at.archive.refusal;
    view.archive(model);
  };

  /** Preview the selected row: its first bytes, read now. */
  const preview = async () => {
    const token = ++previewed;
    const at = top();
    const node = at?.selected == null ? undefined : at.tree.byId.get(at.selected);
    if (!at?.archive || !node) return view.preview(null);
    const entry = node.entry;
    const name = node.name;
    /** @param {PreviewModel} model */
    const show = (model) => {
      if (token === previewed) view.preview(model);
    };
    if (node.kind === "folder")
      return show({
        kind: "folder",
        name,
        caption: `${node.files} ${node.files === 1 ? "file" : "files"}, ${formatSize(node.size)}`,
      });
    if (!entry) return view.preview(null);
    if (entry.encrypted) return show({ kind: "message", name, text: ENCRYPTED });
    if (entry.refusal) return show({ kind: "message", name, text: entry.refusal });
    if (entry.kind === "link")
      return show({ kind: "message", name, text: `A link to ${entry.link ?? "a path not read"}.` });
    try {
      const big = entry.size > TEXT_LIMIT;
      const bytes = await at.archive.read(entry, big ? TEXT_LIMIT : Number.POSITIVE_INFINITY);
      if (token !== previewed) return;
      const inner = await detectFormat(
        memorySource(bytes.subarray(0, Math.max(HEX_LIMIT, 64 * 1024))),
        name,
      ).catch(() => null);
      const archive =
        inner && inner.key !== "img" && inner.key !== "tar"
          ? inner.label
          : inner?.key === "tar" && /\.tar$/i.test(name)
            ? "tar"
            : "";
      let shown = bytes;
      if (
        !archive &&
        big &&
        /^\x89PNG|^\xff\xd8\xff|^GIF8|^RIFF/.test(String.fromCharCode(...bytes.subarray(0, 4)))
      )
        shown = await at.archive.read(entry, Math.min(entry.size, 32 * 1024 * 1024));
      if (token === previewed) show(previewOf(name, entry.size, shown, archive));
    } catch (error) {
      show({ kind: "message", name, text: message(error) });
    }
  };

  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    render();
    view.focus();
    return preview();
  };

  const holding = (/** @type {string} */ buffer) => {
    const file = held.get(buffer);
    if (!file) throw new Error(`No archive ${buffer}.`);
    return file;
  };
  const forget = (/** @type {string} */ buffer) => {
    const file = held.get(buffer);
    if (file?.watchId) watches.delete(file.watchId);
    held.delete(buffer);
  };

  /** Read the file and open it as its first level. @param {string} buffer @param {string} path */
  const load = async (buffer, path) => {
    const name = nameOf(path);
    view.progress(`Opening ${name}…`);
    try {
      const { source, size } = await files.open(path);
      const first = await openLevel(source, name);
      return { buffer, path, name, size, levels: [first] };
    } finally {
      view.progress("");
    }
  };

  /**
   * Answer one of the desk's requests: a failure goes to the status line and ends the request with
   * the same words; a success clears the status line.
   * @param {string} name @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
        say("");
      } catch (error) {
        say(message(error));
        throw error;
      }
    });

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const file = await load(buffer, path);
    forget(buffer);
    held.set(buffer, file);
    void present(buffer);
    const watchId = await files.watch(path);
    if (watchId && held.get(buffer) === file) {
      file.watchId = watchId;
      watches.set(watchId, buffer);
    }
  });

  answer("desk.files.save", () => {
    throw new Error("Archives opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const file = holding(buffer);
    const fresh = await load(buffer, asked ?? file.path);
    file.levels = fresh.levels;
    file.size = fresh.size;
    if (shown === buffer) void present(buffer);
  });

  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    holding(buffer);
    void present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    holding(buffer);
    forget(buffer);
    if (shown !== buffer) return;
    shown = null;
    render();
    view.preview(null);
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const file = buffer === undefined ? undefined : held.get(buffer);
    if (!file) return;
    commands.run("desk.files.changed", { path: file.path }).catch(() => {});
  });

  render();

  return {
    /** Select a row and preview it. @param {string} id */
    select(id) {
      const at = top();
      if (!at?.tree.byId.has(id)) return Promise.resolve();
      at.selected = id;
      render();
      return preview();
    },
    /** Open or close a folder. @param {string} id */
    toggle(id) {
      const at = top();
      if (!at) return;
      if (at.expanded.has(id)) at.expanded.delete(id);
      else if (at.tree.byId.get(id)?.kind === "folder") at.expanded.add(id);
      render();
    },
    /** Mark a row for "Extract selected", or unmark it. @param {string} id */
    mark(id) {
      const at = top();
      if (!at?.tree.byId.has(id)) return;
      if (at.marked.has(id)) at.marked.delete(id);
      else at.marked.add(id);
      render();
    },
    /** @param {Sort["by"]} by */
    sort(by) {
      sort = { by, descending: sort.by === by ? !sort.descending : false };
      render();
    },
    /** @param {string} text */
    filter(text) {
      filter = text;
      render();
    },
    /** Open the archive in an entry one level down. @param {string} id */
    async open(id) {
      const file = current();
      const at = top();
      const entry = at?.tree.byId.get(id)?.entry;
      if (!file || !at?.archive || !entry || entry.kind !== "file") return;
      if (entry.size > WRITE_LIMIT) return say(`${nameOf(id)} is too large to open here.`);
      try {
        const bytes = await at.archive.read(entry);
        const inner = await openLevel(memorySource(bytes), nameOf(id));
        if (current() !== file) return;
        // Only an archive opens a level down; a damaged or plain file says why on the status line.
        if (!inner.archive)
          return say(
            inner.format === "Unknown"
              ? `${nameOf(id)} is not an archive Archives opens.`
              : (inner.note ?? ""),
          );
        file.levels.push(inner);
        say("");
        void present(file.buffer);
      } catch (error) {
        say(message(error));
      }
    },
    /** Back to the archive this one is inside. */
    up() {
      const file = current();
      if (!file || file.levels.length < 2) return;
      file.levels.pop();
      void present(file.buffer);
    },
    /** Extract the marked rows (or the selected one), or everything. @param {"selected" | "all"} which */
    async extract(which) {
      const file = current();
      const at = top();
      if (!file || !at) return;
      if (!at.archive) return say(at.note ?? "Nothing to extract.");
      const order = new Map(at.archive.entries.map((e, i) => [e, i]));
      const ids =
        which === "all"
          ? [""]
          : at.marked.size
            ? [...at.marked]
            : at.selected === null
              ? []
              : [at.selected];
      const chosen = new Set(
        ids.flatMap((id) => {
          const node = at.tree.byId.get(id);
          return node ? entriesUnder(node) : [];
        }),
      );
      const list = [...chosen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      const name = file.levels.length > 1 ? at.name : file.name;
      render();
      await extractor.extract(at.archive, list, { name, beside: folderOf(file.path) });
      render();
    },
    /** Stop an extraction between files. */
    stop() {
      extractor.stop();
    },
  };
}
