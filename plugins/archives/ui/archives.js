// The archives plugin without its DOM. It answers the desk's file and buffer requests for the files
// it holds, opens each with ranged reads, keeps one tree per archive level (an archive inside one
// opens a level down), previews the selected entry and runs extractions; long work shows on the
// progress element with Cancel (jobs.js). It only talks to ctx.commands, ctx.bridge, the SDK's
// byteSource and startWorker (passed in) and a view, so the SDK's test host runs it.

import { formatSize } from "./bytes.js";
import { createExtractor, MEMORY_LIMIT } from "./extract.js";
import { createFiles, folderOf, nameOf } from "./files.js";
import { createJobs } from "./jobs.js";
import { closeLevels, openLevel } from "./opening.js";
import { createPreviews } from "./previews.js";
import { memorySource } from "./source.js";
import { entriesUnder, visibleRows } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Detail} Detail
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Sort} Sort
 * @typedef {import("./preview.js").PreviewModel} PreviewModel
 * @typedef {import("./source.js").Source} Source
 * @typedef {import("./jobs.js").Progress} Progress
 * @typedef {import("./opening.js").Level} Level
 * @typedef {{
 *   byteSource: import("./files.js").ByteSource,
 *   startWorker?: import("./library-client.js").StartWorker,
 * }} Sdk the SDK's functions, passed in so tests run on the workspace's copy
 * @typedef {{
 *   buffer: string, path: string, name: string, format: string, size: number, levels: string[],
 *   details: Detail[], note?: string, refusal?: string, rows: Row[], summary: string,
 *   sort: Sort, filter: string, selected: string | null, extracting: boolean,
 * }} ArchiveModel
 * @typedef {{
 *   archive(model: ArchiveModel | null): void, preview(model: PreviewModel | null): void,
 *   status(text: string): void, progress(progress: Progress | null): void, focus(): void,
 * }} View
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
const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {Sdk} sdk
 */
export function createArchives({ bridge, commands }, view, { byteSource, startWorker }) {
  const files = createFiles(bridge, byteSource);
  const jobs = createJobs((progress) => view.progress(progress));
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

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const extractor = createExtractor({ bridge, commands }, files, {
    say,
    changed: () => render(),
    jobs,
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

  const { reading, preview } = createPreviews(view, jobs, top);

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
    if (file) closeLevels(file.levels);
    held.delete(buffer);
  };

  /**
   * Open `source` as a level, as a job: the bytes read so far say how far a long listing is.
   * @param {Source} source @param {string} name
   */
  const opening = (source, name) =>
    jobs.run(`Opening ${name}`, "", async (job) => {
      let read = 0;
      let done = false;
      /** @type {Source} */
      const counted = {
        size: source.size,
        read: async (offset, length) => {
          const bytes = await source.read(offset, length);
          read += bytes.length;
          if (!done) job.report(null, 1, `${formatSize(read)} read`);
          return bytes;
        },
      };
      try {
        return await openLevel(counted, name, { startWorker, job });
      } finally {
        done = true;
      }
    });

  /** Read the file and open it as its first level. @param {string} buffer @param {string} path */
  const load = async (buffer, path) => {
    const name = nameOf(path);
    const { source, size } = await files.open(path);
    const first = await opening(source, name);
    return { buffer, path, name, size, levels: [first] };
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
    closeLevels(file.levels);
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
      const node = at?.tree.byId.get(id);
      const entry = node?.entry;
      if (!file || !at?.archive || !entry || entry.kind !== "file") return;
      if (entry.size > MEMORY_LIMIT) return say(`${nameOf(id)} is too large to open here.`);
      try {
        const bytes = await reading(at.archive, entry, Infinity, `Reading ${nameOf(id)}`);
        const inner = await opening(memorySource(bytes), nameOf(id));
        if (current() !== file) return closeLevels([inner]);
        // Only an archive opens a level down; a damaged or plain file says why on the status line.
        if (!inner.archive) {
          closeLevels([inner]);
          return say(
            inner.format === "Unknown"
              ? `${nameOf(id)} is not an archive Archives opens.`
              : (inner.note ?? ""),
          );
        }
        file.levels.push(inner);
        say("");
        void present(file.buffer);
      } catch (error) {
        say(aborted(error) ? `Opening ${nameOf(id)} was cancelled.` : message(error));
      }
    },
    /** Back to the archive this one is inside. */
    up() {
      const file = current();
      if (!file || file.levels.length < 2) return;
      closeLevels([/** @type {Level} */ (file.levels.pop())]);
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
    /** Stop what runs: an extraction between files, an opening, a preview's decode. */
    stop() {
      extractor.stop();
      jobs.cancelAll();
    },
  };
}
