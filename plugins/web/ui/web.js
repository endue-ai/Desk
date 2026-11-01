// The web plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, desk.buffers.show, .closed; .save is refused), reads each file in ranges with progress
// (the SDK's readBytes), asks with perm.request for a folder its grants do not cover, turns the
// bytes into a model (formats.js, in a worker for large pages and archives), reads the files a page
// uses from the page's folder, and opens links with shell.open. Reading, opening and drawing are
// one job: Cancel on the progress bar, or another request, stops it and keeps what was on screen.
// It only talks to ctx.commands, ctx.bridge and a view, so the SDK's test host runs it.
import { detect, LABELS } from "./detect.js";
import { createExternal } from "./external.js";
import { openFile } from "./formats.js";
import { NoWorker, openInWorker } from "./remote.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./formats.js").Model} Model
 * @typedef {{ buffer: string, path: string, name: string, size: number, model: Model }} Shown
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {(label: string, value: number | null, max: number, detail: string) => void} Report
 * @typedef {{ signal: AbortSignal, progress: Report }} Job  what the view draws a new file under
 * @typedef {{ show(file: Shown | null, job?: Job): unknown, status(text: string): void,
 *   focus(): void, progress?(value: Progress | null): void }} View
 * @typedef {Shown & { watchId?: string, close?(): void }} OpenFile
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   startWorker?: import("./remote.js").StartWorker, workerOver?: number }} Options
 */

/** Files over this size are opened in a worker when their format needs no DOM. */
const WORKER_OVER = 8 * 1024 * 1024;
const OFF_THREAD = new Set(["html", "xhtml", "mhtml", "webarchive", "warc", "warc.gz", "maff"]);

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** The folder a file is in: Web asks for, and reads under, whole folders. */
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};

const scopeOf = (/** @type {string} */ folder) => {
  /** @type {{ permission: "fs:read", paths: string[] }} */
  const scope = { permission: "fs:read", paths: [`${folder}/**`] };
  return scope;
};

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

const bytesText = (/** @type {number} */ done, /** @type {number} */ total) =>
  `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes`;

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
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {Options} options
 */
export function createWeb({ bridge, commands }, view, options) {
  const { read: readBytes, startWorker, workerOver = WORKER_OVER } = options;
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
  const external = createExternal(bridge);

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  const render = async () => {
    const file = shown === null ? undefined : files.get(shown);
    await view.show(file ? visible(file) : null);
  };
  const present = async (/** @type {string} */ buffer) => {
    shown = buffer;
    await render();
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

  /** The file's bytes, in ranges with progress. A refusal asks once for its folder and reads again. */
  const read = async (
    /** @type {string} */ path,
    /** @type {AbortSignal} */ signal,
    /** @type {(done: number, total: number) => void} */ onProgress,
  ) => {
    const scope = scopeOf(folderOf(path));
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = () => readBytes({ bridge }, { path, scope }, { signal, onProgress });
    const failed = (/** @type {unknown} */ error) => {
      if (signal.aborted) return error;
      return codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    };
    try {
      return await call();
    } catch (error) {
      if (signal.aborted || codeOf(error) !== "permission_denied") throw failed(error);
    }
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Web`,
      })
      .catch(() => ({ granted: false }));
    signal.throwIfAborted();
    if (!decision.granted) throw refused;
    try {
      return await call();
    } catch (error) {
      throw failed(error);
    }
  };

  /** A file a page uses, read under the page's folder grant; never asks. Null when it cannot. */
  const resource =
    (/** @type {string} */ page, /** @type {AbortSignal} */ signal) =>
    async (/** @type {string} */ path) => {
      const folder = folderOf(page);
      const scope = scopeOf(path.startsWith(`${folder}/`) ? folder : folderOf(path));
      try {
        return await readBytes({ bridge }, { path, scope }, { signal });
      } catch {
        return null;
      }
    };

  /** Read a file and turn it into a model: in a worker when it is large and needs no DOM. */
  const load = async (
    /** @type {string} */ buffer,
    /** @type {string} */ path,
    /** @type {AbortSignal} */ signal,
    /** @type {Report} */ report,
  ) => {
    const name = nameOf(path);
    report("Reading", null, 1, name);
    const bytes = await read(path, signal, (done, total) =>
      report("Reading", done, total, bytesText(done, total)),
    );
    const size = bytes.length;
    const disk = { read: resource(path, signal) };
    const format = detect(bytes, path);
    /** @type {OpenFile} */
    const file = { buffer, path, name, size, model: { kind: "details", format: "", reason: "" } };
    if (startWorker && size > workerOver && OFF_THREAD.has(format)) {
      report("Opening", null, 1, name);
      try {
        const opened = await openInWorker(bytes, path, { startWorker, disk, signal });
        return Object.assign(file, opened);
      } catch (error) {
        if (signal.aborted) throw error;
        if (!(error instanceof NoWorker)) {
          const reason = error instanceof Error ? error.message : String(error);
          file.model = {
            kind: "details",
            format: LABELS[format],
            reason: `Web could not open it: ${reason}`,
          };
          return file;
        }
      }
    }
    file.model = await openFile(bytes, path, disk);
    return file;
  };

  /**
   * Read, open and (when `draw`) draw a file as one job. Cancel, or another request, stops it:
   * the visit fails with the words, and what was on screen stays.
   */
  const job = async (/** @type {string} */ buffer, /** @type {string} */ path, draw = true) => {
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
      file = await load(buffer, path, signal, report);
      signal.throwIfAborted();
      if (draw) await view.show(visible(file), { signal, progress: report });
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

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const file = await job(buffer, path);
    forget(buffer);
    files.set(buffer, file);
    // The view drew it as part of the job.
    shown = buffer;
    view.focus();
    await watch(file);
  });

  answer("desk.files.save", () => {
    throw new Error("Web opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const file = held(buffer);
    const fresh = await job(buffer, asked ?? file.path, shown === buffer);
    if (files.get(buffer) !== file) return fresh.close?.();
    file.close?.();
    file.model = fresh.model;
    file.size = fresh.size;
    file.close = fresh.close;
  });

  answer("desk.buffers.show", async (args) => {
    stopOpening();
    const { buffer } = requested(args);
    held(buffer);
    await present(buffer);
  });

  answer("desk.buffers.closed", async (args) => {
    const { buffer } = requested(args);
    const pending = openingBuffer;
    stopOpening();
    // A buffer closed while it opened was never held: stopping its opening is all there is.
    if (pending === buffer && !files.has(buffer)) return;
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
