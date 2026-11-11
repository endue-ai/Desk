// The archives plugin without its DOM. It answers the desk's file and buffer requests for the files
// it holds, opens each with ranged reads, keeps one tree per archive level (an archive inside one
// opens a level down), previews the selected entry and runs what the person does (actions.js); long
// work shows on the progress element with Cancel (jobs.js). Put to sleep while nobody sees it, it
// keeps its archives, their levels and the place in each (keep.js) and comes back to them; an
// archive the desk lists that the frame lost opens again when shown. It only talks to ctx.commands,
// ctx.bridge, ctx.surface, the SDK's byteSource, startWorker and keepFiles (passed in) and a view,
// so the SDK's test host runs it.

import { createActions } from "./actions.js";
import { createExtractor } from "./extract.js";
import { createFiles, nameOf } from "./files.js";
import { createJobs } from "./jobs.js";
import { placeOf, readPlace } from "./keep.js";
import { closeLevels, createOpener } from "./opening.js";
import { createPreviews } from "./previews.js";
import { visibleRows } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Detail} Detail
 * @typedef {import("./tree.js").Row} Row
 * @typedef {import("./tree.js").Sort} Sort
 * @typedef {import("./preview.js").PreviewModel} PreviewModel
 * @typedef {import("./jobs.js").Progress} Progress
 * @typedef {import("./opening.js").Level} Level
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {{
 *   byteSource: import("./files.js").ByteSource,
 *   startWorker?: import("./library-client.js").StartWorker,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles,
 * }} Sdk the SDK's functions, passed in so tests run on the workspace's copy
 * @typedef {{
 *   buffer: string, path: string, name: string, format: string, size: number, levels: string[],
 *   details: Detail[], note?: string, refusal?: string, rows: Row[], summary: string,
 *   sort: Sort, filter: string, selected: string | null, extracting: boolean, top?: number,
 * }} ArchiveModel `top`: the row to scroll the tree to, when a file is shown again or comes back
 * @typedef {{
 *   archive(model: ArchiveModel | null): void, preview(model: PreviewModel | null): void,
 *   status(text: string): void, progress(progress: Progress | null): void, focus(): void,
 *   top?(): number,
 * }} View `top`: the row at the top of the tree now
 * @typedef {{ buffer: string, path: string, name: string, size: number, levels: Level[],
 *   watchId?: string, top?: number }} Held `top`: the row at its top when another file was shown
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

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "surface">} ctx
 * @param {View} view
 * @param {Sdk} sdk
 */
export function createArchives({ bridge, commands, surface }, view, sdk) {
  const { byteSource, startWorker, keepFiles } = sdk;
  const files = createFiles(bridge, byteSource);
  const jobs = createJobs((progress) => view.progress(progress));
  /** @type {Map<string, Held>} */
  const held = new Map();
  /** @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  /** How the frame shows every archive: one sort and one filter. */
  const frame = { sort: /** @type {Sort} */ ({ by: "name", descending: false }), filter: "" };
  let said = "";
  /** Bumped by every show: an archive coming back from a sleep does not cover a later one. */
  let shows = 0;

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
  const shownLevel = () => current()?.levels.at(-1);
  // Put to sleep while nobody sees it, Archives keeps its archives and comes back to them.
  const kept = keepFiles(surface, {
    files: () =>
      [...held.values()].map((file) => ({
        buffer: file.buffer,
        path: file.path,
        place: placeOf({ ...file, top: file.buffer === shown ? view.top?.() : file.top }, frame),
      })),
    shown: () => shown,
    readPlace,
  });
  /** Buffers this frame closed: a show of one does not open it again. @type {Set<string>} */
  const closed = new Set();
  const keptOf = (/** @type {string} */ buffer) => kept.files().find((f) => f.buffer === buffer);

  /** @param {number} [top] the row to scroll the tree to */
  const render = (top = undefined) => {
    const file = current();
    const at = shownLevel();
    if (!file || !at) return view.archive(null);
    const { rows, summary } = visibleRows(at.tree.root, {
      expanded: at.expanded,
      marked: at.marked,
      sort: frame.sort,
      filter: frame.filter,
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
      sort: frame.sort,
      filter: frame.filter,
      selected: at.archive ? at.selected : null,
      extracting: extractor.running,
    };
    if (at.note) model.note = at.note;
    if (at.archive?.refusal) model.refusal = at.archive.refusal;
    if (top !== undefined) model.top = top;
    view.archive(model);
  };

  const { reading, preview } = createPreviews(view, jobs, shownLevel);
  const { opening, openInner, reopen } = createOpener({ jobs, reading, startWorker });

  /**
   * Show a held file, with the focus unless it is coming back from a sleep. Switching files keeps
   * the row at the top of the tree with each.
   * @param {string} buffer @param {{ focus?: boolean, top?: number }} [how]
   */
  const present = (buffer, { focus = true, top = undefined } = {}) => {
    shows++;
    const switching = shown !== buffer;
    const before = shown === null ? undefined : held.get(shown);
    if (switching && before) before.top = view.top?.();
    shown = buffer;
    render(top ?? (switching ? (held.get(buffer)?.top ?? 0) : undefined));
    if (focus) view.focus();
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
   * Read the file and open it as its first level; without `ask` (coming back from a sleep) a read
   * its grants do not cover is not asked for.
   * @param {string} buffer @param {string} path @param {{ ask?: boolean }} [how]
   */
  const load = async (buffer, path, { ask = true } = {}) => {
    const name = nameOf(path);
    const { source, size } = await files.open(path, { ask });
    const first = await opening(source, name);
    return { buffer, path, name, size, levels: [first] };
  };

  /** The newest opening of each buffer: a show of it waits for it; an older one gives way. */
  /** @type {Map<string, { token: number, done: Promise<boolean>, waking: boolean }>} */
  const underway = new Map();
  let openings = 0;

  /**
   * Open `path` as `buffer`: a visit, or an archive the desk lists that this frame lost, as a sleep
   * kept it. Coming back from a sleep it neither asks for the folder nor takes the focus, and a file
   * the person showed meanwhile stays on screen.
   * @param {string} buffer @param {string} path @param {number} token
   * @param {{ place?: KeptPlace, waking?: boolean }} how
   */
  const openAs = async (buffer, path, token, { place, waking = false }) => {
    const seen = shows;
    const file = await load(buffer, path, { ask: !waking });
    if (place) await reopen(file.levels, place.levels);
    if (underway.get(buffer)?.token !== token || closed.has(buffer))
      return closeLevels(file.levels);
    forget(buffer);
    kept.take(buffer);
    held.set(buffer, file);
    if (place?.top !== undefined) file.top = place.top;
    if (waking && place) {
      frame.sort = place.sort ?? frame.sort;
      frame.filter = place.filter ?? frame.filter;
    }
    if (!waking || shows === seen) void present(buffer, { focus: !waking, top: file.top });
    // The watch the file had before the sleep still follows it.
    if (place?.watchId) {
      file.watchId = place.watchId;
      watches.set(place.watchId, buffer);
      return;
    }
    const watchId = await files.watch(path);
    if (watchId && held.get(buffer) === file) {
      file.watchId = watchId;
      watches.set(watchId, buffer);
    }
  };
  /** @param {string} buffer @param {string} path @param {{ place?: KeptPlace, waking?: boolean }} [how] */
  const begin = (buffer, path, how = {}) => {
    closed.delete(buffer);
    const token = ++openings;
    const done = openAs(buffer, path, token, how);
    const settled = done.then(
      () => true,
      () => false,
    );
    underway.set(buffer, { token, done: settled, waking: how.waking === true });
    void settled.then(() => {
      if (underway.get(buffer)?.token === token) underway.delete(buffer);
    });
    return done;
  };
  /** Open again an archive the desk lists that this frame lost, unless it closed it itself. */
  const lost = (/** @type {string} */ buffer, /** @type {string | undefined} */ path) => {
    const from = path ?? keptOf(buffer)?.path;
    const missing = !held.has(buffer) && !closed.has(buffer) && !underway.has(buffer);
    return from && missing ? begin(buffer, from, { place: keptOf(buffer)?.place }) : undefined;
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

  answer("desk.files.visit", (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    return begin(buffer, path);
  });

  answer("desk.files.save", () => {
    throw new Error("Archives opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const reopening = lost(buffer, asked);
    if (reopening) return reopening;
    const file = holding(buffer);
    const fresh = await load(buffer, asked ?? file.path);
    closeLevels(file.levels);
    file.levels = fresh.levels;
    file.size = fresh.size;
    if (shown === buffer) void present(buffer);
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // Its file still opening (the window coming back from a sleep, or a visit): shown once it is.
    // A visit that failed said so itself; one that did not open as the window woke opens now.
    const before = underway.get(buffer);
    const ok = before ? await before.done : true;
    const reopening = ok || before?.waking ? lost(buffer, path) : undefined;
    if (reopening) return reopening;
    holding(buffer);
    void present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    closed.add(buffer);
    const wasKept = kept.take(buffer);
    if (!held.has(buffer) && (wasKept || underway.has(buffer))) return;
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

  // Back from a sleep, the archive that was on screen opens again as it was; the others open when
  // shown. One the person shows meanwhile goes first, and this one says nothing over it.
  const back = kept.shown === null ? undefined : keptOf(kept.shown);
  if (back) {
    const mine = shows;
    begin(back.buffer, back.path, { place: back.place, waking: true }).then(
      () => {
        if (shows === mine + 1) say("");
      },
      (error) => {
        if (shows === mine) say(message(error));
      },
    );
  }

  return createActions({
    frame,
    current,
    shownLevel,
    render: () => render(),
    preview,
    present,
    say,
    openInner,
    extractor,
    jobs,
  });
}
