// The reader without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, desk.buffers.show, .closed; .save is refused: the reader never writes), reads each file
// as base64 with fs.read (asking once with perm.request for the file's folder when its grants do
// not cover it), opens it as a book (open.js), follows it with fs.watch, and keeps each file's
// position, zoom, bookmarks and notes in its store (marks.js). The SDK's test host runs it with a
// recording view.
import { fromBase64 } from "./formats/bytes.js";
import { emptyMarks, loadMarks, NOTE_MAX, saveMarks } from "./marks.js";
import { openBook } from "./open.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./open.js").Book} Book
 * @typedef {import("./marks.js").At} At
 * @typedef {import("./marks.js").Marks} Marks
 * @typedef {{ buffer: string, path: string, name: string, size: number, book: Book } & Marks} ShownModel
 * @typedef {{ show(model: ShownModel | null): void, marks(model: ShownModel): void, status(text: string): void, focus(): void }} View
 * @typedef {ShownModel & { bytes: Uint8Array, watchId?: string, password?: string }} Open
 *   `bytes` stays only while the book waits for its password; the readers keep what they need.
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
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

const NOTHING = new Uint8Array(0);
/** A file's bytes are kept only for a book that waits for its password. */
const kept = (/** @type {Book} */ book, /** @type {Uint8Array} */ bytes) =>
  book.kind === "password" ? bytes : NOTHING;

/** What the status line says once a file is open. */
const opened = (/** @type {{ name: string, book: Book }} */ { name, book }) => {
  if (book.kind === "pages")
    return `${name}: ${book.format}, ${book.pages.length} ${book.pages.length === 1 ? "page" : "pages"}.`;
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
 * @param {{ pdfjs?: () => Promise<object> }} [options]
 */
export function createReader({ bridge, commands }, view, options = {}) {
  /** @type {Map<string, Open>} */
  const files = new Map();
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
  const forget = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) return;
    if (file.watchId) watches.delete(file.watchId);
    files.delete(buffer);
    Promise.resolve(
      file.book.kind === "pages" || file.book.kind === "chapters" ? file.book.close?.() : undefined,
    ).catch(() => {});
  };

  /** fs.read as base64; a refusal asks once for the file's folder and tries again. */
  const read = async (/** @type {string} */ path) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = () => bridge.call("fs.read", { path, encoding: "base64", scope });
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    try {
      return fromBase64((await call()).content);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Reader`,
      })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return fromBase64((await call()).content);
    } catch (error) {
      throw failed(error);
    }
  };

  const open = (
    /** @type {Uint8Array} */ bytes,
    /** @type {string} */ path,
    /** @type {string | undefined} */ password,
  ) => openBook(bytes, { name: nameOf(path), path, password, pdfjs: options.pdfjs });

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
    view.status(`Opening ${nameOf(path)}…`);
    const bytes = await read(path);
    const [book, marks] = await Promise.all([
      open(bytes, path, undefined),
      loadMarks(bridge, path),
    ]);
    forget(buffer);
    /** @type {Open} */
    const file = {
      buffer,
      path,
      name: nameOf(path),
      size: bytes.length,
      book,
      bytes: kept(book, bytes),
      ...marks,
    };
    files.set(buffer, file);
    present(buffer);
    view.status(opened(file));
    await watch(file);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const file = held(buffer);
    const bytes = await read(asked ?? file.path);
    const book = await open(bytes, file.path, file.password);
    Promise.resolve(
      file.book.kind === "pages" || file.book.kind === "chapters" ? file.book.close?.() : undefined,
    ).catch(() => {});
    Object.assign(file, { book, bytes: kept(book, bytes), size: bytes.length });
    if (shown === buffer) present(buffer);
  });

  answer("desk.files.save", () => {
    throw new Error("Reader opens files read-only.");
  });

  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    flush();
    present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
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
      const book = await open(file.bytes, file.path, password);
      if (files.get(file.buffer) !== file) return;
      file.book = book;
      file.bytes = kept(book, file.bytes);
      // Held in memory for a revert, never kept in the store.
      if (book.kind !== "password") file.password = password;
      present(file.buffer);
      view.status(book.kind === "password" ? "That password is not right." : opened(file));
    },
  };
}

export { emptyMarks };
