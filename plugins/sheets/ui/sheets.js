// The sheets plugin without its DOM. It answers the desk's file and buffer requests
// (desk.files.visit, .save, .revert, desk.buffers.show, .closed) for the spreadsheets it holds,
// opens them one at a time (loading.js), follows each file on disk, and reads CSV again when the
// csv-encoding setting changes. CSV and TSV in UTF-8 are edited and saved byte for byte (save.js);
// the desk hears of unsaved edits with desk.buffers.update. Put to sleep while nobody sees it, it
// keeps its files, the place in each and a CSV's unsaved edits, and comes back to them (keep.js,
// wake.js). It only talks to ctx.commands, ctx.bridge, ctx.settings, ctx.surface and a view, so the
// SDK's test host runs it.

import { ENCODINGS } from "./csv.js";
import { extensionOf } from "./detect.js";
import { createLoading, NAME, scopeOf } from "./loading.js";
import { addressOf } from "./model.js";
import { editing, writeFile } from "./save.js";
import { createWake } from "./wake.js";

export { NAME } from "./loading.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./book.js").Book} Book
 * @typedef {import("./save.js").Tier} Tier
 * @typedef {{
 *   buffer: string, path: string, name: string, size: number, book: Book, tier?: Tier,
 *   modified?: boolean, editable?: (r: number, c: number) => boolean,
 * }} Shown tier, modified and editable once the file is open (not while it is a preview)
 * @typedef {(bytes: Uint8Array, file: { name: string, encoding: string }, options: import("./parse.js").ParseOptions) => Book | Promise<Book>} Open
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{
 *   show(model: Shown | null): void, status(text: string): void, focus(): void,
 *   progress?(value: Progress | null): void, commit?(): void,
 *   where?(buffer: string): import("./keep.js").Where | undefined,
 *   restore?(buffer: string, where: Partial<import("./keep.js").Where>): void,
 * }} View commit: the edit in progress on screen becomes an edit before a save; where and
 *   restore: the place in a file, kept across a sleep
 * @typedef {Shown & import("./save.js").Editing & { watchId?: string, notice?: string }} Held
 *   notice: what the status line says of it until the person edits it (an edit a sleep lost)
 * @typedef {{ edit(r: number, c: number, text: string): boolean, refused(buffer: string, r: number, c: number): void }} Sheets
 *   What the view asks of the file on screen: set a cell's text (false when the file has no
 *   field there or is read-only), and say why a cell cannot be edited
 */

const SETTING = "csv-encoding";
/** Formats whose text depends on the csv-encoding setting. */
const TEXT = new Set(["csv", "tsv"]);

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/** Base64 to bytes, without fetch: the frame may reach no URL, data: ones included. */
export function bytesOf(/** @type {string} */ base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encodingOf = (/** @type {unknown} */ value) =>
  typeof value === "string" && value in ENCODINGS ? value : "auto";

/** What the status line says once a file is open. */
export function summary(/** @type {Shown & { notice?: string }} */ { name, book, notice }) {
  if (notice) return notice;
  if (book.kind === "details") return book.reason;
  if (book.kind === "link") return `${name} is a Google Sheets shortcut.`;
  const n = book.sheets.length;
  return `Opened ${name}: ${n} sheet${n === 1 ? "" : "s"}.`;
}

/** Why a cell of an open file cannot be edited. */
function refusal(/** @type {Held} */ file, /** @type {number} */ r, /** @type {number} */ c) {
  if (file.doc) return `${addressOf(r, c)} is not in ${file.name}: only its own cells are edited.`;
  return file.tier.detail ?? file.tier.refusal ?? `${NAME} opens ${file.name} read-only.`;
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface">} ctx
 * @param {View} view
 * @param {{ open: Open, read: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles }} options
 */
export function createSheets({ bridge, commands, settings, surface }, view, options) {
  /** Open files by the buffer the desk named them with. @type {Map<string, Held>} */
  const files = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let encoding = "auto";
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  /** @returns {Shown | null} */
  const model = (/** @type {Held | undefined} */ held) => {
    if (!held) return null;
    const { buffer, path, name, size, book, tier, doc, editable } = held;
    return { buffer, path, name, size, book, tier, modified: doc?.modified ?? false, editable };
  };
  const onScreen = () => model(shown === null ? undefined : files.get(shown));
  const render = () => view.show(onScreen());
  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    render();
    view.focus();
  };

  const held = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) throw new Error(`No spreadsheet ${buffer}.`);
    return file;
  };
  const forget = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (file?.watchId) watches.delete(file.watchId);
    files.delete(buffer);
  };

  /** Follow the file on disk. Without a watch the file still opens; changes just go unnoticed. */
  const watch = async (/** @type {Held} */ file) => {
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
   * Answer one of the desk's requests. A failure goes to the status line and ends the request with
   * the same words, which the desk shows in its own notice; a success says what the handler says.
   * @param {string} name
   * @param {(args: unknown) => Promise<string> | string} handler
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

  const ready = (async () => {
    const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
    const own = await settings.get(SETTING).catch(() => undefined);
    const values = /** @type {Record<string, unknown> | undefined} */ (init.settings);
    const fromInit = values?.[`endue.sheets.${SETTING}`];
    encoding = encodingOf(own ?? fromInit);
  })();

  const loading = createLoading({
    bridge,
    view,
    open: options.open,
    readBytes: options.read,
    say,
    render,
    onScreen,
    ready,
    encoding: () => encoding,
  });
  const { load } = loading;

  /** Tell the desk when a file's edits leave it unsaved, and when they no longer do. */
  const report = (/** @type {Held} */ file) => {
    const modified = file.doc?.modified ?? false;
    if (modified === file.reported || files.get(file.buffer) !== file) return;
    file.reported = modified;
    commands.run("desk.buffers.update", { id: file.buffer, modified }).catch(() => {});
  };

  /** Hold an opened file for its buffer and follow it on disk, unless it keeps a watch it had. */
  const hold = (/** @type {Held} */ file, /** @type {string | undefined} */ watchId) => {
    forget(file.buffer);
    files.set(file.buffer, file);
    if (!watchId) return watch(file);
    file.watchId = watchId;
    watches.set(watchId, file.buffer);
  };

  // Put to sleep while nobody sees it, Sheets keeps its files and comes back to them (ADR 0070).
  const wake = createWake({
    surface,
    keepFiles: options.keepFiles,
    view,
    load,
    files: () => [...files.values()],
    shown: () => shown,
    has: (buffer) => files.has(buffer),
    hold,
    present: (file) => {
      shown = file.buffer;
      render();
    },
    unsaved: (file) => report(file),
    marked: (buffer) => {
      commands.run("desk.buffers.update", { id: buffer, modified: false }).catch(() => {});
    },
    say,
    summary,
    busy: () => loading.opening() !== undefined,
  });

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const loaded = await load(buffer, path);
    wake.opened(buffer);
    /** @type {Held} */
    const file = { ...loaded, ...editing(loaded) };
    const watching = hold(file, undefined);
    shown = buffer;
    render();
    if (!loaded.focused) view.focus();
    await watching;
    return summary(file);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path } = requested(args);
    // A file the frame lost opens from disk, where it was; what the sleep kept unsaved is gone.
    const reopened = await wake.lost(buffer, path, { edits: false });
    if (reopened) return summary(reopened);
    const before = held(buffer);
    const file = await load(buffer, path ?? before.path, { preview: shown === buffer });
    if (files.get(buffer) !== before) return "";
    Object.assign(before, { ...file, ...editing(file), watchId: before.watchId });
    delete before.notice;
    if (shown === buffer) render();
    return summary(before);
  });

  answer("desk.files.save", async (args) => {
    const { buffer, path } = requested(args);
    const file = (await wake.lost(buffer, undefined)) ?? held(buffer);
    if (!file.doc) throw new Error(file.tier.refusal ?? `${NAME} opens files read-only.`);
    if (shown === buffer) view.commit?.();
    const saving = file.doc.save();
    await writeFile(bridge, path ?? file.path, saving.bytes);
    saving.commit();
    // desk.files clears the list's mark after a save; edits made while it was written stay
    // unsaved, and the desk hears so once this answer has reached it.
    file.reported = false;
    delete file.notice;
    if (shown === buffer) render();
    if (file.doc.modified) setTimeout(() => report(file), 0);
    return `Saved ${file.name}.`;
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // Its file still opening as the window woke waits for it; one the frame lost opens now.
    await wake.settled(buffer);
    await wake.lost(buffer, path, { show: true });
    loading.stop();
    const file = held(buffer);
    present(file.buffer);
    // The desk shows a file right after its visit: the status line keeps saying what it is.
    return summary(file);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    const pending = loading.stop();
    if (wake.closed(buffer) && !files.has(buffer)) return "";
    if (pending === buffer && !files.has(buffer)) return "";
    held(buffer);
    forget(buffer);
    if (shown !== buffer) return "";
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    shown = null;
    render();
    return "";
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const file = buffer === undefined ? undefined : files.get(buffer);
    if (!file) return;
    // desk.files.on-change decides: it asks for desk.files.revert when the file should reload.
    commands.run("desk.files.changed", { path: file.path }).catch(() => {});
  });

  settings.onChange(({ key, value }) => {
    if (key !== SETTING && key !== `endue.sheets.${SETTING}`) return;
    encoding = encodingOf(value);
    // Reuse the same ranged read / worker path, including cancellation, for an encoding change.
    const reload = async () => {
      for (const file of files.values()) {
        if (!TEXT.has(extensionOf(file.name))) continue;
        // Unsaved edits are the person's: the file keeps the encoding it was edited in.
        if (file.doc?.modified) continue;
        const next = await load(file.buffer, file.path, { preview: shown === file.buffer });
        if (files.get(file.buffer) !== file) continue;
        Object.assign(file, { ...next, ...editing(next), watchId: file.watchId });
        if (shown === file.buffer) render();
      }
    };
    reload().catch((error) => say(error instanceof Error ? error.message : String(error)));
  });

  render();
  wake.start();

  /** @type {Sheets} */
  return {
    edit(r, c, text) {
      const file = shown === null ? undefined : files.get(shown);
      const result = file?.doc?.set(r, c, text) ?? "outside";
      if (!file || result === "outside") return false;
      if (result === "changed") {
        delete file.notice;
        report(file);
        render();
      }
      return true;
    },
    refused(buffer, r, c) {
      const file = files.get(buffer);
      say(file ? refusal(file, r, c) : `${NAME} is still opening this file.`);
    },
  };
}
