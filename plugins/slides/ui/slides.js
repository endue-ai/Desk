// The slides plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save, desk.buffers.show, .closed) for the presentations it holds, reads them in ranges
// with the SDK's readBytes and shows the progress, asks with perm.request for a file its grants do
// not cover, opens a file over 8 MiB in a worker that stays while its deck is held, follows each
// file on disk, and opens a slide's links with shell.open (reading.js). A presentation the desk lists
// and the frame lost (it slept, or its page loaded again) opens again, on the slide it was on when a
// sleep kept it (keep.js). It only talks to ctx.commands, ctx.bridge, ctx.surface and a view, so the
// SDK's test host runs it.
import { placeOf, readPlace } from "./keep.js";
import { openFile } from "./open.js";
import { codeOf, openInWorker, readWhole, scopeOf } from "./reading.js";
import { createLinks } from "./render/links.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./open.js").Opened} Opened
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {{ buffer: string, path: string, name: string, size: number, opened: Opened }} Shown
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{ show(model: Shown | null, slide?: number): void, status(text: string): void,
 *   focus(): void, slideOf?(buffer: string): number | undefined,
 *   progress?(value: Progress | null): void }} View
 * @typedef {Shown & { watchId?: string, close?: () => void }} OpenFile
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   startWorker?: typeof import("@endue-ai/plugin-sdk").startWorker,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles }} Options
 */

/** Files over this many bytes open in a worker. */
export const LARGE = 8 * 1024 * 1024;

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const bytesOf = (/** @type {number} */ done, /** @type {number} */ total) =>
  `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes`;

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/** What the status line says about an opened file. @param {string} name @param {Opened} opened */
function summary(name, opened) {
  if (opened.kind === "deck") {
    const n = opened.deck.slides.length;
    return `${name}: ${n} ${n === 1 ? "slide" : "slides"}${opened.deck.textOnly ? ", text only" : ""}.`;
  }
  if (opened.kind === "details") return `${name}: ${opened.reason}`;
  return `${name}: ${opened.sentence}`;
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "surface">} ctx
 * @param {View} view
 * @param {Options} options
 */
export function createSlides({ bridge, commands, surface }, view, options) {
  const { read: readBytes, startWorker } = options;
  /** @type {Map<string, OpenFile>} */
  const files = new Map();
  /** @type {Map<string, string>} */
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
  // Put to sleep while nobody sees it, Slides keeps its presentations and comes back to them.
  const kept = options.keepFiles(surface, {
    files: () =>
      [...files.values()].map((f) => ({
        buffer: f.buffer,
        path: f.path,
        place: placeOf(f, view.slideOf?.(f.buffer)),
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

  const render = (/** @type {number | undefined} */ slide) => {
    const file = shown === null ? undefined : files.get(shown);
    if (!file) return view.show(null);
    const { buffer, path, name, size, opened } = file;
    view.show({ buffer, path, name, size, opened }, slide);
  };
  /** Show a held file, on `slide` when a sleep kept one; with the focus unless the window woke. */
  const present = (/** @type {string} */ buffer, { slide = undefined, focus = true } = {}) => {
    shown = buffer;
    render(slide);
    if (focus) view.focus();
  };
  const held = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) throw new Error(`No presentation ${buffer}.`);
    return file;
  };
  const forget = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (file?.watchId) watches.delete(file.watchId);
    file?.close?.();
    files.delete(buffer);
  };
  /** Stop the opening under way, if any; the deck on screen stays. Answers its buffer. */
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
   * Read and open a file, showing the progress; a reader's failure is a details view, never an
   * error. Cancel stops the read or the worker and keeps what is on screen. Without `ask` (a window
   * coming back from a sleep) a refused read is not asked for.
   * @returns {Promise<{ size: number, opened: Opened, close?: () => void }>}
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
      const failed = (/** @type {unknown} */ error) => {
        if (job.signal.aborted) throw error;
        const why = error instanceof Error ? error.message : String(error);
        /** @type {Opened} */
        const opened = {
          kind: "details",
          format: "Unknown format",
          reason: `The file could not be read (${why}).`,
        };
        return { opened, close: undefined };
      };
      const { opened, close } = await (startWorker && size > LARGE
        ? openInWorker(bytes, name, { signal: job.signal, startWorker })
        : openFile(bytes, name).then((opened) => ({ opened, close: undefined }))
      ).catch(failed);
      if (job.signal.aborted) {
        close?.();
        job.signal.throwIfAborted();
      }
      return { size, opened, close };
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

  const watch = async (/** @type {OpenFile} */ file) => {
    await bridge.call("fs.watch", { path: file.path, scope: scopeOf(file.path) }).then(
      ({ watchId }) => {
        if (files.get(file.buffer) !== file) return;
        file.watchId = watchId;
        watches.set(watchId, file.buffer);
      },
      () => {},
    );
  };

  /**
   * Answer a desk request: a failure goes to the status line and ends the request with the same
   * words; a success says what is on screen.
   * @param {string} name @param {(args: unknown) => Promise<string> | string} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        say(await handler(args));
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  /**
   * Open `path` as `buffer`: a visit, or a presentation the desk lists that this frame lost, on the
   * slide a sleep kept. Coming back from a sleep it neither asks for the folder nor takes the focus.
   * @param {string} buffer
   * @param {string} path
   * @param {{ place?: KeptPlace, waking?: boolean }} [how]
   */
  const openAs = async (buffer, path, { place, waking = false } = {}) => {
    const { size, opened, close } = await load(buffer, path, { ask: !waking });
    forget(buffer);
    kept.take(buffer);
    closed.delete(buffer);
    /** @type {OpenFile} */
    const file = { buffer, path, name: nameOf(path), size, opened, close };
    files.set(buffer, file);
    present(buffer, { slide: place?.slide, focus: !waking });
    // The watch the file had before the sleep still follows it.
    if (place?.watchId) {
      file.watchId = place.watchId;
      watches.set(place.watchId, buffer);
    } else await watch(file);
    return summary(file.name, opened);
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
  /** Open again a presentation the desk lists that this frame lost, unless it closed it itself. */
  const lost = (/** @type {string} */ buffer, /** @type {string | undefined} */ path) => {
    const from = path ?? keptOf(buffer)?.path;
    const missing = !files.has(buffer) && !closed.has(buffer) && openingBuffer !== buffer;
    return from && missing ? begin(buffer, from, { place: keptOf(buffer)?.place }) : undefined;
  };

  answer("desk.files.visit", (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    return begin(buffer, path);
  });

  answer("desk.files.save", () => {
    throw new Error("Slides opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const reopening = lost(buffer, asked);
    if (reopening) return reopening;
    const file = held(buffer);
    const { size, opened, close } = await load(buffer, asked ?? file.path);
    if (files.get(buffer) !== file) {
      close?.();
      return "";
    }
    file.close?.();
    Object.assign(file, { size, opened, close });
    if (shown === buffer) render();
    return summary(file.name, opened);
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
    const file = held(buffer);
    stopOpening();
    present(buffer);
    return summary(file.name, file.opened);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    generation++;
    closed.add(buffer);
    const wasKept = kept.take(buffer);
    // Closing the buffer that is still opening stops that opening.
    const pending = openingBuffer === buffer && stopOpening() === buffer;
    if ((pending || wasKept) && !files.has(buffer)) return "";
    held(buffer);
    forget(buffer);
    if (shown === buffer) {
      shown = null;
      render();
    }
    return "";
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const file = buffer === undefined ? undefined : files.get(buffer);
    if (!file) return;
    commands.run("desk.files.changed", { path: file.path }).catch(() => {});
  });

  render();

  // Back from a sleep, the presentation that was on screen opens again on its slide; the others
  // open when shown. A show of another one meanwhile goes first, and this one gives way quietly.
  const back = kept.shown === null ? undefined : keptOf(kept.shown);
  if (back) {
    const mine = generation + 1;
    begin(back.buffer, back.path, { place: back.place, waking: true }).then(
      (words) => {
        if (generation === mine) say(words);
      },
      (error) => {
        if (generation === mine) say(error instanceof Error ? error.message : String(error));
      },
    );
  }

  return {
    /** A link on a slide: http, https and mailto open in the system's browser or mail app. */
    external: async (/** @type {string} */ url) => {
      try {
        if (await links(url)) say(`Opened ${url}`);
      } catch (error) {
        const why = codeOf(error) === "permission_denied" ? "not allowed" : codeOf(error);
        say(`Could not open ${url}: ${why}.`);
      }
    },
  };
}
