// The docs plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save refused, desk.buffers.show, .closed), reads each file in ranges with the SDK's
// readBytes and shows the progress, asks with perm.request for the file's folder when the grants do
// not cover it (reading.js), opens it into the document model (in a worker for a file over 8 MiB) or
// the details view, follows it on disk, and opens a document's links with shell.open. A document the
// desk lists and the frame lost (it slept, or its page loaded again) opens again, where it was when a
// sleep kept it (keep.js). It only talks to ctx.commands, ctx.bridge, ctx.surface and a view, so the
// SDK's test host runs it with a recording view.
import { placeOf, readPlace } from "./keep.js";
import { codeOf, openInWorker, readWhole, scopeOf } from "./reading.js";
import { createLinks } from "./view/links.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./model.js").Opened} Opened
 * @typedef {{ buffer: string, path: string, name: string, size: number, doc: Opened }} Shown
 * @typedef {import("./keep.js").At} At
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {{ at: At | null, zoom: number | null }} Where where the view is in the pages, and the
 *   zoom the person chose (null: fitted)
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{ show(shown: Shown | null, where?: Where): unknown, status(text: string): void,
 *   focus(): void, where?(): Where, progress?(value: Progress | null): void }} View
 * @typedef {Shown & { watchId?: string, at?: At }} Open
 * @typedef {typeof import("./open.js").openDocument} OpenDocument
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   startWorker?: typeof import("@endue-ai/plugin-sdk").startWorker, open?: OpenDocument,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles }} Options
 */

/**
 * The readers, open.js and every format under it, are not part of the plugin's first load: they
 * start loading once the plugin is mounted (it says hello without them), and a document waits for
 * them only when it comes first.
 */
const readers = () => import("./open.js");

/** @type {OpenDocument} */
const openDocument = async (bytes, path) => (await readers()).openDocument(bytes, path);

/** Files over this many bytes open in a worker. */
export const LARGE = 8 * 1024 * 1024;

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const bytesOf = (/** @type {number} */ done, /** @type {number} */ total) =>
  `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes`;
const DAMAGED = "This file is damaged, or it is a variant Docs does not read.";

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "surface">} ctx
 * @param {View} view
 * @param {Options} options
 */
export function createDocs({ bridge, commands, surface }, view, options) {
  const { read: readBytes, startWorker, open = openDocument } = options;
  if (!options.open) readers().catch(() => {});
  /** @type {Map<string, Open>} */
  const docs = new Map();
  /** @type {Map<string, string>} watch id -> buffer */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";
  /** The opening under way and its buffer: its work stops with this controller. */
  /** @type {AbortController | undefined} */
  let opening;
  let openingBuffer = "";
  /** Bumped by every opening, show and close: a quiet opening that lost to one says nothing. */
  let generation = 0;
  const links = createLinks(bridge);
  // Put to sleep while nobody sees it, Docs keeps its documents and comes back to them (ADR 0070).
  const kept = options.keepFiles(surface, {
    files: () =>
      [...docs.values()].map((d) => ({
        buffer: d.buffer,
        path: d.path,
        place: placeOf(d, d.buffer === shown ? view.where?.() : undefined),
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
  const render = (/** @type {Where | undefined} */ where) => {
    const doc = shown === null ? undefined : docs.get(shown);
    if (!doc) return view.show(null);
    const { watchId: _, at: __, ...visible } = doc;
    return view.show(visible, where);
  };
  /**
   * Show a held document where it was when the person left it (or at `where`), with the focus
   * unless the window is coming back from a sleep. The document left behind remembers its place.
   * @param {string} buffer
   * @param {{ where?: Where, focus?: boolean }} [how]
   */
  const present = async (buffer, { where, focus = true } = {}) => {
    const left = shown === null || shown === buffer ? undefined : docs.get(shown);
    const at = left && view.where?.().at;
    if (left && at) left.at = at;
    const doc = docs.get(buffer);
    const back = shown !== buffer && doc?.at ? { at: doc.at, zoom: null } : undefined;
    shown = buffer;
    await render(where ?? back);
    if (focus) view.focus();
  };
  const held = (/** @type {string} */ buffer) => {
    const doc = docs.get(buffer);
    if (!doc) throw new Error(`No document ${buffer}.`);
    return doc;
  };
  const forget = (/** @type {string} */ buffer) => {
    const doc = docs.get(buffer);
    if (doc?.watchId) watches.delete(doc.watchId);
    docs.delete(buffer);
  };
  /** Stop the opening under way, if any; the document on screen stays. Answers its buffer. */
  const stopOpening = () => {
    const buffer = openingBuffer;
    if (!opening) return buffer;
    opening.abort();
    opening = undefined;
    openingBuffer = "";
    view.progress?.(null);
    return buffer;
  };

  /**
   * Read and open a file, showing the progress; a reader's failure is the details view, never an
   * error. Cancel stops the read or the worker and keeps what is on screen. Without `ask` (a window
   * coming back from a sleep) a refused read is not asked for.
   */
  const load = async (
    /** @type {string} */ buffer,
    /** @type {string} */ path,
    { ask = true } = {},
  ) => {
    stopOpening();
    const job = new AbortController();
    opening = job;
    openingBuffer = buffer;
    const name = nameOf(path);
    const report = (
      /** @type {string} */ label,
      /** @type {number | null} */ value = null,
      max = 1,
      detail = name,
    ) => {
      if (opening === job)
        view.progress?.({ label, value, max, detail, cancel: () => job.abort() });
    };
    say(`Opening ${name}…`);
    report("Reading");
    try {
      const bytes = await readWhole({ bridge, readBytes }, path, {
        signal: job.signal,
        onProgress: (done, total) => report("Reading", done, total, bytesOf(done, total)),
        ask,
      });
      const size = bytes.length;
      report("Opening");
      /** @type {Opened} */
      const doc = await (startWorker && size > LARGE
        ? openInWorker(bytes, path, { signal: job.signal, startWorker })
        : open(bytes, path)
      ).catch((error) => {
        if (job.signal.aborted) throw error;
        return {
          kind: "details",
          format: "unknown",
          formatName: "Unknown format",
          reason: DAMAGED,
        };
      });
      job.signal.throwIfAborted();
      // The view says what it shows in place of "Opening…": nothing here clears its words.
      said = "";
      return { buffer, path, name, size, doc };
    } catch (error) {
      if (job.signal.aborted) throw new Error(`Opening ${name} was cancelled.`);
      throw error;
    } finally {
      if (opening === job) {
        opening = undefined;
        openingBuffer = "";
        view.progress?.(null);
      }
    }
  };

  const watch = async (/** @type {Open} */ doc) => {
    const { path } = doc;
    await bridge.call("fs.watch", { path, scope: scopeOf(path) }).then(
      ({ watchId }) => {
        if (docs.get(doc.buffer) !== doc) return;
        doc.watchId = watchId;
        watches.set(watchId, doc.buffer);
      },
      () => {},
    );
  };

  /**
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
   * Open `path` as `buffer`: a visit, or a document the desk lists that this frame lost, at `place`
   * when a sleep kept one. Coming back from a sleep it neither asks for the folder nor takes the focus.
   * @param {string} buffer
   * @param {string} path
   * @param {{ place?: KeptPlace, waking?: boolean }} [how]
   */
  const openFile = async (buffer, path, { place, waking = false } = {}) => {
    /** @type {Open} */
    const doc = await load(buffer, path, { ask: !waking });
    forget(buffer);
    kept.take(buffer);
    closed.delete(buffer);
    if (place?.at) doc.at = place.at;
    docs.set(buffer, doc);
    const where = place ? { at: place.at ?? null, zoom: place.zoom ?? null } : undefined;
    await present(buffer, { where, focus: !waking });
    // The watch the document had before the sleep still follows it.
    if (place?.watchId) {
      doc.watchId = place.watchId;
      watches.set(place.watchId, buffer);
    } else await watch(doc);
  };
  /** The document on its way to open, if any: a show of it waits for it. */
  /** @type {{ buffer: string, done: Promise<boolean>, waking: boolean } | undefined} */
  let underway;
  /** @type {typeof openFile} */
  const begin = (buffer, path, how = {}) => {
    generation++;
    const done = openFile(buffer, path, how);
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
  /** Open again a document the desk lists that this frame lost, unless it closed it itself. */
  const lost = (/** @type {string} */ buffer, /** @type {string | undefined} */ path) => {
    const from = path ?? keptOf(buffer)?.path;
    const missing = !docs.has(buffer) && !closed.has(buffer) && openingBuffer !== buffer;
    return from && missing ? begin(buffer, from, { place: keptOf(buffer)?.place }) : undefined;
  };

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    await begin(buffer, path);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const reopening = lost(buffer, asked);
    if (reopening) return reopening;
    const old = held(buffer);
    const doc = await load(buffer, asked ?? old.path);
    if (docs.get(buffer) !== old) return;
    docs.set(buffer, { ...doc, watchId: old.watchId, at: old.at });
    if (shown === buffer) await render();
  });

  answer("desk.files.save", () => {
    throw new Error("Docs opens files read-only.");
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // Its document still opening (the window coming back from a sleep, or a visit): shown once it
    // is. A visit that failed said so itself; one that did not open as the window woke opens now.
    const before = underway?.buffer === buffer ? underway : undefined;
    const ok = before ? await before.done : true;
    const reopening = ok || before?.waking ? lost(buffer, path) : undefined;
    if (reopening) return reopening;
    generation++;
    held(buffer);
    stopOpening();
    await present(buffer);
  });

  answer("desk.buffers.closed", async (args) => {
    const { buffer } = requested(args);
    generation++;
    closed.add(buffer);
    const wasKept = kept.take(buffer);
    // Closing the buffer that is still opening stops that opening.
    const pending = openingBuffer === buffer && stopOpening() === buffer;
    if ((pending || wasKept) && !docs.has(buffer)) return;
    held(buffer);
    forget(buffer);
    if (shown !== buffer) return;
    shown = null;
    await render();
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const doc = buffer === undefined ? undefined : docs.get(buffer);
    if (!doc) return;
    commands.run("desk.files.changed", { path: doc.path }).catch(() => {});
  });

  render();

  // Back from a sleep, the document that was on screen opens again where it was; the others open
  // when shown. A show of another document meanwhile goes first, and this one gives way quietly.
  const back = kept.shown === null ? undefined : keptOf(kept.shown);
  if (back) {
    const mine = generation + 1;
    begin(back.buffer, back.path, { place: back.place, waking: true }).catch((error) => {
      if (generation === mine) say(error instanceof Error ? error.message : String(error));
    });
  }

  return {
    /** A link in the document: http, https and mailto open in the system's browser or mail app. */
    external: async (/** @type {string} */ url) => {
      try {
        if (await links(url)) say(`Opened ${url}`);
      } catch (error) {
        say(
          `Could not open ${url}: ${codeOf(error) === "permission_denied" ? "not allowed" : codeOf(error)}.`,
        );
      }
    },
  };
}
