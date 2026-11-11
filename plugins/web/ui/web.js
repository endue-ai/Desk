// The web plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, desk.buffers.show, .closed; .save is refused), reads each file in ranges with progress
// (the SDK's readBytes), asks with perm.request for a folder its grants do not cover, turns the
// bytes into a model (formats.js, in a worker for large pages and archives), reads the files a page
// uses from the page's folder, and opens links with shell.open. Reading, opening and drawing are
// one job: Cancel on the progress bar, or another request, stops it and keeps what was on screen. A
// file the desk lists and the frame lost (it slept, or its page loaded again) opens again, where it
// was when a sleep kept it (keep.js). It only talks to ctx.commands, ctx.bridge, ctx.surface and a
// view, so the SDK's test host runs it.
import { createExternal } from "./external.js";
import { placeOf, readPlace } from "./keep.js";
import { codeOf, folderOf, loadFile, readers, scopeOf } from "./reading.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./formats.js").Model} Model
 * @typedef {import("./keep.js").Where} Where
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {{ buffer: string, path: string, name: string, size: number, model: Model }} Shown
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {(label: string, value: number | null, max: number, detail: string) => void} Report
 * @typedef {{ signal: AbortSignal, progress: Report }} Job  what the view draws a new file under
 * @typedef {{ show(file: Shown | null, job?: Job, where?: Where): unknown, status(text: string): void,
 *   focus(): void, where?(): Where | null, progress?(value: Progress | null): void }} View
 * @typedef {Shown & { watchId?: string, close?(): void, at?: Where }} OpenFile
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   startWorker?: import("./remote.js").StartWorker, workerOver?: number,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles }} Options
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/** @param {OpenFile} file @returns {Shown} */
const visible = ({ buffer, path, name, size, model }) => ({ buffer, path, name, size, model });

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "surface">} ctx
 * @param {View} view
 * @param {Options} options
 */
export function createWeb({ bridge, commands, surface }, view, options) {
  const { read: readBytes, startWorker, workerOver } = options;
  readers().catch(() => {});
  /** Open files by the buffer the desk named them with. @type {Map<string, OpenFile>} */
  const files = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";
  /** The job in flight, and the buffer it opens. @type {AbortController | undefined} */
  let opening;
  /** @type {string | undefined} */
  let openingBuffer;
  /** Bumped by every opening, show and close: a quiet opening that lost to one says nothing. */
  let generation = 0;
  const external = createExternal(bridge);
  // Put to sleep while nobody sees it, Web keeps its files and comes back to them (ADR 0070).
  const kept = options.keepFiles(surface, {
    files: () =>
      [...files.values()].map((f) => ({
        buffer: f.buffer,
        path: f.path,
        place: placeOf(f, f.buffer === shown ? (view.where?.() ?? undefined) : f.at),
      })),
    shown: () => shown,
    readPlace,
  });
  /** Buffers this frame closed: a show of one does not open it again. @type {Set<string>} */
  const closed = new Set();
  /** The kept file of a buffer this frame does not hold yet. */
  const keptOf = (/** @type {string} */ buffer) => kept.files().find((f) => f.buffer === buffer);

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  const render = async () => {
    const file = shown === null ? undefined : files.get(shown);
    await view.show(file ? visible(file) : null);
  };
  /** The file on screen remembers where the person was in it, before another one shows. */
  const remember = () => {
    const file = shown === null ? undefined : files.get(shown);
    const where = file && view.where?.();
    if (file && where) file.at = where;
  };
  /** Show a held file where it was when the person left it. */
  const present = async (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    const back = shown !== buffer ? file?.at : undefined;
    if (shown !== buffer) remember();
    shown = buffer;
    await view.show(file ? visible(file) : null, undefined, back);
    view.focus();
  };
  /** Stop the job in flight; what was on screen is drawn again. */
  const stopOpening = () => {
    const job = opening;
    if (!job) return;
    opening = undefined;
    openingBuffer = undefined;
    job.abort();
    view.progress?.(null);
    void render().catch(() => {});
  };

  const held = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) throw new Error(`No file ${buffer}.`);
    return file;
  };

  const forget = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (file?.watchId) watches.delete(file.watchId);
    file?.close?.();
    files.delete(buffer);
  };

  /**
   * Read, open and (when `draw`) draw a file as one job, `where` the person was in it when a sleep
   * kept that; without `ask` (a window coming back from a sleep) a refused read is not asked for.
   * Cancel, or another request, stops it: the visit fails with the words, and what was on screen stays.
   * @param {string} buffer
   * @param {string} path
   * @param {{ draw?: boolean, ask?: boolean, where?: Where }} [how]
   */
  const job = async (buffer, path, { draw = true, ask = true, where } = {}) => {
    stopOpening();
    const controller = new AbortController();
    opening = controller;
    openingBuffer = buffer;
    const { signal } = controller;
    const name = nameOf(path);
    /** @type {Report} */
    const report = (label, value, max, detail) => {
      if (opening === controller)
        view.progress?.({ label, value, max, detail, cancel: () => controller.abort() });
    };
    /** @type {OpenFile | undefined} */
    let file;
    try {
      file = await loadFile({ bridge, readBytes, startWorker, workerOver }, buffer, path, {
        signal,
        report,
        ask,
      });
      signal.throwIfAborted();
      if (draw) await view.show(visible(file), { signal, progress: report }, where);
      signal.throwIfAborted();
      return file;
    } catch (error) {
      file?.close?.();
      if (!signal.aborted) throw error;
      // Cancelled here (not by another request, which draws what it wants): put back what was shown.
      if (opening === controller) await render().catch(() => {});
      throw new Error(`Opening ${name} was cancelled.`);
    } finally {
      if (opening === controller) {
        opening = undefined;
        openingBuffer = undefined;
        view.progress?.(null);
      }
    }
  };

  /** Follow the file on disk. Without a watch the file still shows; changes just go unnoticed. */
  const watch = async (/** @type {OpenFile} */ file) => {
    const { path } = file;
    await bridge.call("fs.watch", { path, scope: scopeOf(folderOf(path)) }).then(
      ({ watchId }) => {
        if (files.get(file.buffer) !== file) return;
        file.watchId = watchId;
        watches.set(watchId, file.buffer);
      },
      () => {},
    );
  };

  /**
   * Answer one of the desk's requests. A failure goes to the status line and ends the request with
   * the same words, which the desk shows in its own notice; a success clears the status line.
   * @param {string} name
   * @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
        say("");
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  /**
   * Open `path` as `buffer`: a visit, or a file the desk lists that this frame lost, where a sleep
   * kept it. Coming back from a sleep it neither asks for the folder nor takes the focus.
   * @param {string} buffer
   * @param {string} path
   * @param {{ place?: KeptPlace, waking?: boolean }} [how]
   */
  const openAs = async (buffer, path, { place, waking = false } = {}) => {
    remember();
    const where = place?.down === undefined ? undefined : { down: place.down, entry: place.entry };
    const file = await job(buffer, path, { ask: !waking, where });
    forget(buffer);
    kept.take(buffer);
    closed.delete(buffer);
    if (where) file.at = where;
    files.set(buffer, file);
    // The view drew it as part of the job.
    shown = buffer;
    if (!waking) view.focus();
    // The watch the file had before the sleep still follows it.
    if (place?.watchId) {
      file.watchId = place.watchId;
      watches.set(place.watchId, buffer);
    } else await watch(file);
  };
  /** The file on its way to open, if any: a show of it waits for it. */
  /** @type {{ buffer: string, done: Promise<boolean>, waking: boolean } | undefined} */
  let underway;
  /** @type {typeof openAs} */
  const begin = (buffer, path, how = {}) => {
    generation++;
    const done = openAs(buffer, path, how);
    const settled = done.then(
      () => true,
      () => false,
    );
    underway = { buffer, done: settled, waking: how.waking === true };
    void settled.then(() => {
      if (underway?.done === settled) underway = undefined;
    });
    return done;
  };
  /** Open again a file the desk lists that this frame lost, unless it closed it itself. */
  const lost = (/** @type {string} */ buffer, /** @type {string | undefined} */ path) => {
    const from = path ?? keptOf(buffer)?.path;
    const missing = !files.has(buffer) && !closed.has(buffer) && openingBuffer !== buffer;
    return from && missing ? begin(buffer, from, { place: keptOf(buffer)?.place }) : undefined;
  };

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    await begin(buffer, path).catch((error) => {
      // The desk drops a buffer whose visit failed or was cancelled: a show of it opens nothing.
      if (!files.has(buffer)) closed.add(buffer);
      throw error;
    });
  });

  answer("desk.files.save", () => {
    throw new Error("Web opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const reopening = lost(buffer, asked);
    if (reopening) return reopening;
    const file = held(buffer);
    const fresh = await job(buffer, asked ?? file.path, { draw: shown === buffer });
    if (files.get(buffer) !== file) return fresh.close?.();
    file.close?.();
    file.model = fresh.model;
    file.size = fresh.size;
    file.close = fresh.close;
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // Its file still opening (the window coming back from a sleep, or a visit): shown once it is.
    // A visit that failed said so itself; one that did not open as the window woke opens now.
    const before = underway?.buffer === buffer ? underway : undefined;
    const ok = before ? await before.done : true;
    const reopening = ok || before?.waking ? lost(buffer, path) : undefined;
    if (reopening) return reopening;
    generation++;
    stopOpening();
    held(buffer);
    await present(buffer);
  });

  answer("desk.buffers.closed", async (args) => {
    const { buffer } = requested(args);
    generation++;
    closed.add(buffer);
    const wasKept = kept.take(buffer);
    const pending = openingBuffer;
    stopOpening();
    // A buffer closed while it opened was never held: stopping its opening is all there is.
    if ((pending === buffer || wasKept) && !files.has(buffer)) return;
    held(buffer);
    forget(buffer);
    if (shown !== buffer) return;
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    shown = null;
    await render();
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const file = buffer === undefined ? undefined : files.get(buffer);
    if (!file) return;
    // Every change: desk.files.on-change decides what happens.
    commands.run("desk.files.changed", { path: file.path }).catch(() => {});
  });

  void render();

  // Back from a sleep, the file that was on screen opens again where it was; the others open when
  // shown. A show of another file meanwhile goes first, and this one gives way quietly.
  const back = kept.shown === null ? undefined : keptOf(kept.shown);
  if (back) {
    const mine = generation + 1;
    begin(back.buffer, back.path, { place: back.place, waking: true }).catch((error) => {
      if (generation === mine) say(error instanceof Error ? error.message : String(error));
    });
  }

  return {
    /** Open a local file the page or a link card points at; the desk picks its plugin. */
    open: async (/** @type {string} */ path) => {
      try {
        await commands.run("desk.files.open", { path });
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
      }
    },
    /** Open a link in the browser or mail app; one that may not leave the desk does nothing. */
    external: async (/** @type {string} */ url) => {
      try {
        if (!(await external(url)))
          say("This link does not open: Web opens http, https and mailto links and local files.");
      } catch (error) {
        say(
          codeOf(error) === "permission_denied"
            ? "Not allowed to open links in the browser."
            : `Could not open the link: ${codeOf(error)}.`,
        );
      }
    },
    say,
  };
}
