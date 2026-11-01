// The reader without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, desk.buffers.show, .closed; .save is refused: the reader never writes), reads each file
// with SDK binary ranges (asking once for the folder when its grants do not cover it), opens it
// as a book (open.js), follows it with fs.watch, and keeps each file's
// position, zoom, bookmarks and notes in its store (marks.js). The SDK's test host runs it with a
// recording view.
import { createLinks } from "./links.js";
import { createLoading } from "./loading.js";
import { emptyMarks, loadMarks, NOTE_MAX, saveMarks } from "./marks.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./open.js").Book} Book
 * @typedef {import("./marks.js").At} At
 * @typedef {import("./marks.js").Marks} Marks
 * @typedef {{ buffer: string, path: string, name: string, size: number, book: Book } & Marks} ShownModel
 * @typedef {{ show(model: ShownModel | null): void, marks(model: ShownModel): void, status(text: string): void, focus(): void, progress?(value: import("./progress.js").Progress | null): void }} View
 * @typedef {ShownModel & { cancel(): void, watchId?: string, password?: string }} Open
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/** Everything under a folder, as a grant's path pattern. */
const UNDER = "/**";
/** @param {string} path @returns {{ permission: "fs:read", paths: string[] }} */
const scopeOf = (path) => ({ permission: "fs:read", paths: [`${folderOf(path)}${UNDER}`] });
/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/** What the status line says once a file is open. */
const opened = (/** @type {{ name: string, book: Book }} */ { name, book }) => {
  if (book.kind === "pages")
    return `${name}: ${book.format}, ${book.pages.length} ${book.pages.length === 1 ? "page" : "pages"}.${book.note ? ` ${book.note}` : ""}`;
  if (book.kind === "chapters")
    return `${name}: ${book.format}, ${book.chapters.length} ${book.chapters.length === 1 ? "chapter" : "chapters"}.`;
  if (book.kind === "password") return "This PDF is protected by a password.";
  return `${name} cannot be shown: ${book.why}`;
};

/** How long the last position waits before it is kept, while the person scrolls. */
const POSITION_DELAY = 600;

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {{ pdfjs?: () => Promise<object>, byteSource: typeof import("@endue-ai/plugin-sdk").byteSource,
 *   readBytes: typeof import("@endue-ai/plugin-sdk").readBytes, startWorker?: import("./djvu-client.js").StartWorker }} options
 */
export function createReader({ bridge, commands }, view, options) {
  /** @type {Map<string, Open>} */
  const files = new Map();
  const loading = createLoading(bridge, view, options);
  const external = createLinks(bridge);
  let generation = 0;
  let openingBuffer;
  /** @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;

  const model = (/** @type {Open} */ f) => {
    const { buffer, path, name, size, book, at, zoom, bookmarks, notes } = f;
    return { buffer, path, name, size, book, at, zoom, bookmarks, notes };
  };
  const current = () => (shown === null ? undefined : files.get(shown));
  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    const file = files.get(buffer);
    view.show(file ? model(file) : null);
    view.focus();
  };
  const held = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) throw new Error(`No file ${buffer}.`);
    return file;
  };
  const keep = (/** @type {Open} */ file) => saveMarks(bridge, file.path, file);
  const flush = () => {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
    const file = current();
    if (file) void keep(file);
  };
  const dispose = (file) => {
    file.cancel();
    Promise.resolve(
      file.book.kind === "pages" || file.book.kind === "chapters" ? file.book.close?.() : undefined,
    ).catch(() => {});
  };
  const forget = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) return;
    if (file.watchId) watches.delete(file.watchId);
    files.delete(buffer);
    dispose(file);
  };

  const watch = async (/** @type {Open} */ file) => {
    await bridge.call("fs.watch", { path: file.path, scope: scopeOf(file.path) }).then(
      ({ watchId }) => {
        if (files.get(file.buffer) !== file) return;
        file.watchId = watchId;
        watches.set(watchId, file.buffer);
      },
      () => {},
    );
  };

  /** @param {string} name @param {(args: unknown) => unknown} handler */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
      } catch (error) {
        view.status(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    flush();
    const mine = ++generation;
    openingBuffer = buffer;
    const [openedFile, marks] = await Promise.all([loading.load(path), loadMarks(bridge, path)]);
    if (mine !== generation) {
      dispose(openedFile);
      throw new Error(`Opening ${nameOf(path)} was cancelled.`);
    }
    openingBuffer = undefined;
    forget(buffer);
    /** @type {Open} */
    const file = { buffer, path, ...openedFile, ...marks };
    files.set(buffer, file);
    present(buffer);
    view.status(opened(file));
    await watch(file);
  });

  const revert = async (args) => {
    const { buffer, path: asked } = requested(args);
    const file = held(buffer);
    const next = await loading.load(asked ?? file.path, file.password);
    if (files.get(buffer) !== file) {
      dispose(next);
      return;
    }
    dispose(file);
    Object.assign(file, next);
    if (shown === buffer) {
      present(buffer);
      view.status(opened(file));
    }
  };
  answer("desk.files.revert", revert);

  answer("desk.files.save", () => {
    throw new Error("Reader opens files read-only.");
  });

  answer("desk.buffers.show", (args) => {
    generation++;
    loading.cancel();
    const { buffer } = requested(args);
    held(buffer);
    flush();
    // The desk follows visit with show; the existing view may still be decoding its first page.
    if (shown === buffer) return view.focus();
    present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    generation++;
    loading.cancel();
    const { buffer } = requested(args);
    if (openingBuffer === buffer && !files.has(buffer)) {
      openingBuffer = undefined;
      return;
    }
    held(buffer);
    if (shown === buffer) flush();
    forget(buffer);
    if (shown !== buffer) return;
    shown = null;
    view.show(null);
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const file = buffer === undefined ? undefined : files.get(buffer);
    if (file) commands.run("desk.files.changed", { path: file.path }).catch(() => {});
  });

  view.show(null);

  /** The marks changed: keep them and show the panel again. */
  const changed = async (/** @type {Open} */ file, /** @type {string} */ said) => {
    const ok = await keep(file);
    if (files.get(file.buffer) === file && shown === file.buffer) view.marks(model(file));
    view.status(ok ? said : "The reader could not keep that: its store refused it.");
  };

  return {
    reload: () => {
      const file = current();
      if (!file) return;
      return revert({ buffer: file.buffer, path: file.path }).catch((error) =>
        view.status(error.message),
      );
    },
    external: (url) =>
      external(url).catch((error) =>
        view.status(`Could not open this link: ${error.message ?? error.code ?? "unknown error"}.`),
      ),
    /** The person moved in the book on screen. A new page is kept at once, a scroll after a pause. */
    moved(/** @type {At} */ at) {
      const file = current();
      if (!file) return;
      const unit = file.at.unit;
      file.at = { unit: at.unit, offset: at.offset };
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
      if (at.unit !== unit) void keep(file);
      else pending = setTimeout(flush, POSITION_DELAY);
    },
    zoomed(/** @type {number} */ zoom) {
      const file = current();
      if (!file) return;
      file.zoom = zoom;
      void keep(file);
    },
    bookmark(/** @type {At} */ at, /** @type {string} */ label) {
      const file = current();
      if (!file) return;
      file.bookmarks = [
        ...file.bookmarks,
        { unit: at.unit, offset: at.offset, label, added: new Date().toISOString() },
      ].sort((a, b) => a.unit - b.unit || a.offset - b.offset);
      return changed(file, `Bookmarked ${label}.`);
    },
    note(/** @type {At} */ at, /** @type {string} */ text) {
      const file = current();
      const trimmed = text.trim().slice(0, NOTE_MAX);
      if (!file || !trimmed) return;
      file.notes = [
        ...file.notes,
        { unit: at.unit, offset: at.offset, text: trimmed, added: new Date().toISOString() },
      ];
      return changed(file, "Note kept.");
    },
    forget(/** @type {"bookmarks" | "notes"} */ kind, /** @type {number} */ index) {
      const file = current();
      if (!file?.[kind][index]) return;
      file[kind] = file[kind].filter((_, i) => i !== index);
      return changed(file, kind === "bookmarks" ? "Bookmark removed." : "Note removed.");
    },
    /** Try a locked PDF's password; a wrong one shows the field again with a word about it. */
    async unlock(/** @type {string} */ password) {
      const file = current();
      if (file?.book.kind !== "password") return;
      view.status("Opening with the password…");
      const next = await loading.load(file.path, password);
      if (files.get(file.buffer) !== file) {
        dispose(next);
        return;
      }
      file.cancel();
      Object.assign(file, next);
      const { book } = next;
      // Held in memory for a revert, never kept in the store.
      if (book.kind !== "password") file.password = password;
      present(file.buffer);
      view.status(book.kind === "password" ? "That password is not right." : opened(file));
    },
  };
}

export { emptyMarks };
