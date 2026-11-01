// The docs plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save refused, desk.buffers.show, .closed), reads each file in ranges with the SDK's
// readBytes and shows the progress, asks with perm.request for the file's folder when the grants do
// not cover it, opens it into the document model (in a worker for a file over 8 MiB) or the details
// view, follows it on disk, and opens a document's links with shell.open. It only talks to
// ctx.commands, ctx.bridge and a view, so the SDK's test host runs it with a recording view.
import { openDocument } from "./open.js";
import { createLinks } from "./view/links.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./model.js").Opened} Opened
 * @typedef {{ buffer: string, path: string, name: string, size: number, doc: Opened }} Shown
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{ show(shown: Shown | null): unknown, status(text: string): void, focus(): void,
 *   progress?(value: Progress | null): void }} View
 * @typedef {Shown & { watchId?: string }} Open
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   startWorker?: typeof import("@endue-ai/plugin-sdk").startWorker, open?: typeof openDocument }} Options
 */

/** Files over this many bytes open in a worker. */
export const LARGE = 8 * 1024 * 1024;

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/** The scope a read carries: the file's whole folder, as the person is asked for it. */
const scopeOf = (/** @type {string} */ path) => {
  /** @type {{ permission: "fs:read", paths: string[] }} */
  const scope = { permission: "fs:read", paths: [`${folderOf(path)}/**`] };
  return scope;
};
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
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
 * Open a document in a worker started with the SDK's startWorker (ui/worker.js): the bytes move to
 * it (they are gone here afterwards) and the model comes back in parts. The signal ends the worker.
 * @param {Uint8Array} bytes @param {string} path
 * @param {{ signal: AbortSignal, startWorker: NonNullable<Options["startWorker"]> }} options
 * @returns {Promise<Opened>}
 */
export function openInWorker(bytes, path, { signal, startWorker }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Docs reader" });
    /** @type {any} */
    let doc;
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Opening was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish();
      reject(new Error(event.message || "The document reader stopped."));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "head") doc = data.doc;
      else if (data.type === "part") {
        const list = typeof data.at === "number" ? doc.sections[data.at].blocks : doc[data.at];
        for (const item of data.items) list.push(item);
      } else if (data.type === "failed" || data.type === "done") {
        finish();
        if (data.type === "failed") reject(new Error(data.message));
        else resolve(data.doc ?? doc);
      }
    };
    worker.postMessage({ bytes, path }, [bytes.buffer]);
  });
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {Options} options
 */
export function createDocs({ bridge, commands }, view, options) {
  const { read: readBytes, startWorker, open = openDocument } = options;
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
  const links = createLinks(bridge);

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const render = () => {
    const doc = shown === null ? undefined : docs.get(shown);
    if (!doc) return view.show(null);
    const { watchId: _, ...visible } = doc;
    return view.show(visible);
  };
  const present = async (/** @type {string} */ buffer) => {
    shown = buffer;
    await render();
    view.focus();
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

  /** The whole file in ranges; a refusal asks once for the file's folder and reads again. */
  const read = async (
    /** @type {string} */ path,
    /** @type {AbortSignal} */ signal,
    /** @type {(done: number, total: number) => void} */ onProgress,
  ) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    const call = () => readBytes({ bridge }, { path, scope }, { signal, onProgress });
    try {
      return await call();
    } catch (error) {
      if (signal.aborted) throw error;
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Docs`,
      })
      .catch(() => ({ granted: false }));
    signal.throwIfAborted();
    if (!decision.granted) throw refused;
    try {
      return await call();
    } catch (error) {
      if (signal.aborted) throw error;
      throw failed(error);
    }
  };

  /**
   * Read and open a file, showing the progress; a reader's failure is the details view, never an
   * error. Cancel stops the read or the worker and keeps what is on screen.
   */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
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
      const bytes = await read(path, job.signal, (done, total) =>
        report("Reading", done, total, bytesOf(done, total)),
      );
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

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const doc = await load(buffer, path);
    forget(buffer);
    docs.set(buffer, doc);
    await present(buffer);
    await watch(doc);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const old = held(buffer);
    const doc = await load(buffer, asked ?? old.path);
    if (docs.get(buffer) !== old) return;
    docs.set(buffer, { ...doc, watchId: old.watchId });
    if (shown === buffer) await render();
  });

  answer("desk.files.save", () => {
    throw new Error("Docs opens files read-only.");
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer } = requested(args);
    held(buffer);
    stopOpening();
    await present(buffer);
  });

  answer("desk.buffers.closed", async (args) => {
    const { buffer } = requested(args);
    // Closing the buffer that is still opening stops that opening.
    const pending = openingBuffer === buffer && stopOpening() === buffer;
    if (pending && !docs.has(buffer)) return;
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
