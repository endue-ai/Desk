// The slides plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save, desk.buffers.show, .closed) for the presentations it holds, reads them in ranges
// with the SDK's readBytes and shows the progress, asks with perm.request for a file its grants do
// not cover, opens a file over 8 MiB in a worker that stays while its deck is held, follows each
// file on disk, and opens a slide's links with shell.open. It only talks to ctx.commands,
// ctx.bridge and a view, so the SDK's test host runs it.
import { imageCache } from "./deck.js";
import { openFile } from "./open.js";
import { createLinks } from "./render/links.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./open.js").Opened} Opened
 * @typedef {{ buffer: string, path: string, name: string, size: number, opened: Opened }} Shown
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{ show(model: Shown | null): void, status(text: string): void, focus(): void,
 *   progress?(value: Progress | null): void }} View
 * @typedef {Shown & { watchId?: string, close?: () => void }} OpenFile
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   startWorker?: typeof import("@endue-ai/plugin-sdk").startWorker }} Options
 */

/** Files over this many bytes open in a worker. */
export const LARGE = 8 * 1024 * 1024;

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/** @type {"fs:read"} */
const FS_READ = "fs:read";
const EVERYTHING_UNDER = "/**";
/** The scope a read carries: the file's folder. @param {string} path */
const scopeOf = (path) => ({
  permission: FS_READ,
  paths: [`${folderOf(path)}${EVERYTHING_UNDER}`],
});
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
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
 * Open a presentation in a worker started with the SDK's startWorker (ui/worker.js): the bytes move
 * to it (they are gone here afterwards), the deck comes back in parts, and its pictures are asked of
 * the worker, which stays until `close`. The signal ends the worker while it opens.
 * @param {Uint8Array} bytes @param {string} name
 * @param {{ signal: AbortSignal, startWorker: NonNullable<Options["startWorker"]> }} options
 * @returns {Promise<{ opened: Opened, close(): void }>}
 */
export function openInWorker(bytes, name, { signal, startWorker }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Slides reader" });
    /** @type {Map<number, (url: string | null) => void>} */
    const asked = new Map();
    let next = 0;
    let closed = false;
    const close = () => {
      closed = true;
      worker.terminate();
      for (const answer of asked.values()) answer(null);
      asked.clear();
    };
    /** @type {any} */
    let opened;
    const abort = () => {
      close();
      reject(new DOMException("Opening was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    const settle = (/** @type {() => void} */ then) => {
      signal.removeEventListener("abort", abort);
      then();
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      close();
      settle(() => reject(new Error(event.message || "The presentation reader stopped.")));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "image") {
        asked.get(data.n)?.(data.url);
        asked.delete(data.n);
      } else if (data.type === "head") opened = data.opened;
      else if (data.type === "slides") opened.deck.slides.push(...data.items);
      else if (data.type === "failed") {
        close();
        settle(() => reject(new Error(data.message)));
      } else if (data.type === "done") {
        if (data.opened) {
          close();
          return settle(() => resolve({ opened: data.opened, close }));
        }
        opened.deck.image = imageCache(
          (id) =>
            new Promise((answer) => {
              if (closed) return answer(null);
              asked.set(++next, answer);
              worker.postMessage({ type: "image", n: next, id });
            }),
        );
        settle(() => resolve({ opened, close }));
      }
    };
    worker.postMessage({ type: "open", bytes, name }, [bytes.buffer]);
  });
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {Options} options
 */
export function createSlides({ bridge, commands }, view, { read: readBytes, startWorker }) {
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
  const links = createLinks(bridge);
  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  const render = () => {
    const file = shown === null ? undefined : files.get(shown);
    if (!file) return view.show(null);
    const { buffer, path, name, size, opened } = file;
    view.show({ buffer, path, name, size, opened });
  };
  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    render();
    view.focus();
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

  /** The whole file in ranges; when the grants do not cover it, ask once for its folder and try again. */
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
      const decision = await bridge
        .call("perm.request", {
          permission: /** @type {Permission} */ (scope),
          reason: `To open ${path} in Slides`,
        })
        .catch(() => ({ granted: false }));
      signal.throwIfAborted();
      if (!decision.granted) throw refused;
      return await call().catch((again) => {
        if (signal.aborted) throw again;
        throw failed(again);
      });
    }
  };

  /**
   * Read and open a file, showing the progress; a reader's failure is a details view, never an
   * error. Cancel stops the read or the worker and keeps what is on screen.
   * @returns {Promise<{ size: number, opened: Opened, close?: () => void }>}
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

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const { size, opened, close } = await load(buffer, path);
    forget(buffer);
    /** @type {OpenFile} */
    const file = { buffer, path, name: nameOf(path), size, opened, close };
    files.set(buffer, file);
    present(buffer);
    await watch(file);
    return summary(file.name, opened);
  });

  answer("desk.files.save", () => {
    throw new Error("Slides opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
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

  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    const file = held(buffer);
    stopOpening();
    present(buffer);
    return summary(file.name, file.opened);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    // Closing the buffer that is still opening stops that opening.
    const pending = openingBuffer === buffer && stopOpening() === buffer;
    if (pending && !files.has(buffer)) return "";
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
