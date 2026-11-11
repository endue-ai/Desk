// The data plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save, desk.buffers.show, .closed), reads files in binary ranges with one ask for the file's
// folder when its grants do not cover it, opens them with formats.js, follows them with fs.watch,
// checks them against their JSON Schema (schema-check.js), edits and saves them in their edit tier
// (edit/), and tells the view what to show. Put to sleep while nobody sees it, it keeps its files,
// how each was shown and their unsaved values, and comes back to them (keep.js, wake.js). It only
// talks to ctx and a view, so the SDK's test host runs it with a recording view.

import { createEditing } from "./edit/editing.js";
import { createSession } from "./edit/session.js";
import { bytesSum } from "./edit/sum.js";
import { openFile } from "./formats.js";
import { createSchemaCheck } from "./schema-check.js";
import { CHECKED, folderOf, nameOf } from "./schemas.js";
import { createValidateWith } from "./validate-with.js";
import { createWake } from "./wake.js";
import { openWorker } from "./worker-client.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {import("./schema-check.js").SchemaState} SchemaState
 * @typedef {import("./edit/session.js").EditTier} EditTier
 * @typedef {{ buffer: string, path: string, name: string, size: number, opened: Opened,
 *   schema: SchemaState, maskKeys: boolean, tier?: EditTier, why?: string }} Shown
 * @typedef {{ show(model: Shown | null): void, schema(buffer: string, state: SchemaState): void,
 *   mask(keys: boolean): void, status(text: string): void, focus(): void,
 *   progress?(state: { phase: string, done: number, total: number } | null): void,
 *   where?(buffer: string): import("./keep.js").Where | undefined,
 *   restore?(buffer: string, where: Partial<import("./keep.js").Where>): void }} View
 * @typedef {Omit<Shown, "maskKeys" | "tier"> & import("./edit/editing.js").EditedFile
 *   & { watchId?: string }} File
 */

const NAME = "Data";
const WORKER_THRESHOLD = 1024 * 1024;

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
export const scopeOf = (/** @type {string} */ path) =>
  /** @type {const} */ ({ permission: "fs:read", paths: [`${folderOf(path)}/**`] });

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface">} ctx
 * @param {View} view
 * @param {import("./formats.js").OpenOptions & { readBytes: typeof import("@endue-ai/plugin-sdk").readBytes, startWorker?: typeof import("@endue-ai/plugin-sdk").startWorker,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles }} options
 */
export function createData({ bridge, commands, settings, surface }, view, options) {
  /** @type {Map<string, File>} */
  const files = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let maskKeys = true;
  let said = "";
  /** @type {{ buffer: string, stop: AbortController } | null} */
  let loading = null;

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  const ready = settings
    .get("mask-secrets")
    .then((value) => {
      maskKeys = value !== false;
    })
    .catch(() => {});
  settings.onChange(({ key, value }) => {
    if (key !== "mask-secrets") return;
    maskKeys = value !== false;
    view.mask(maskKeys);
  });

  const modelOf = (/** @type {File} */ file) => {
    const { buffer, path, name, size, opened, schema, tier, why } = file;
    return { buffer, path, name, size, opened, schema, maskKeys, tier, why };
  };
  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    const file = files.get(buffer);
    view.show(file ? modelOf(file) : null);
    view.focus();
  };
  const held = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (!file) throw new Error(`No file ${buffer}.`);
    return file;
  };
  const forget = (/** @type {string} */ buffer) => {
    const file = files.get(buffer);
    if (file?.watchId) watches.delete(file.watchId);
    file?.opened.remote?.close();
    files.delete(buffer);
  };

  /** Read a file's bytes. When the grants do not cover it, ask once for its folder and try again. */
  const read = async (/** @type {string} */ path, ask = true, readOptions = {}) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = () => options.readBytes({ bridge }, { path, scope }, readOptions);
    const failed = (/** @type {unknown} */ error) =>
      error?.name === "AbortError"
        ? error
        : codeOf(error) === "permission_denied"
          ? refused
          : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    try {
      return await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied" || !ask) throw failed(error);
    }
    const reason = `To open ${path} in ${NAME}`;
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call();
    } catch (error) {
      throw failed(error);
    }
  };

  const check = createSchemaCheck(bridge, (path) => read(path, false));

  /** Follow the file on disk. Without a watch it still opens; changes just go unnoticed. */
  const watch = async (/** @type {File} */ file) => {
    const { path } = file;
    await bridge.call("fs.watch", { path, scope: scopeOf(path) }).then(
      ({ watchId }) => {
        if (files.get(file.buffer) !== file) return;
        file.watchId = watchId;
        watches.set(watchId, file.buffer);
      },
      () => {},
    );
  };

  /** What the status line says about a file once it is open. */
  const opening = (/** @type {File} */ file) => {
    const { opened, name } = file;
    if (opened.reason) return `${name}: ${opened.reason}`;
    if (!opened.doc) return `${name}: ${opened.note ?? "opened as raw text."}`;
    const [first, ...rest] = opened.doc.errors;
    if (!first) return `Opened ${name} as ${opened.label}.`;
    const count = rest.length === 0 ? "1 parse error" : `${rest.length + 1} parse errors`;
    return `Opened ${name} as ${opened.label}: ${count}, the first at line ${first.line}.`;
  };

  const runSchema = async (/** @type {File} */ file) => {
    file.schema = file.opened.remote
      ? await file.opened.remote.request("schema", { path: file.path, size: file.size })
      : await check(file);
    if (files.get(file.buffer) === file) view.schema(file.buffer, file.schema);
  };

  /** Read and open a file for its buffer; without `ask` (a window waking) a refused read stays so. */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path, ask = true) => {
    await ready;
    const name = nameOf(path);
    loading?.stop.abort(new DOMException("Opening was cancelled.", "AbortError"));
    const stop = new AbortController();
    loading = { buffer, stop };
    const progress = (phase) => (done, total) => view.progress?.({ phase, done, total });
    view.progress?.({ phase: "Reading", done: 0, total: 0 });
    try {
      const bytes = await read(path, ask, {
        signal: stop.signal,
        onProgress: progress("Reading"),
      });
      const size = bytes.length;
      view.progress?.({ phase: "Parsing", done: 0, total: size });
      const opened =
        size > WORKER_THRESHOLD
          ? await openWorker(name, bytes, options.startWorker, {
              signal: stop.signal,
              onProgress: progress("Parsing"),
              maskKeys,
              bridge,
              read: (path) => read(path, false),
            })
          : openFile(name, bytes, options);
      if (stop.signal.aborted) {
        opened.remote?.close();
        throw new DOMException("Opening was cancelled.", "AbortError");
      }
      const checked = CHECKED.has(opened.format) && opened.doc !== undefined;
      /** @type {SchemaState} */
      const schema = { state: checked ? "loading" : "none", errors: [] };
      // Above 1 MiB the worker keeps the file and its edits; it said the tier with the rest.
      const session = opened.remote ? undefined : createSession(name, bytes, opened);
      const { tier = "read-only", why } = session ?? opened;
      // The bytes on disk its edits are made on, which a sleep checks them against (keep.js).
      const sum = tier === "read-only" ? undefined : (opened.sum ?? bytesSum(bytes));
      const base = sum === undefined ? undefined : { size, sum };
      return /** @type {File} */ ({
        buffer,
        path,
        name,
        size,
        opened,
        schema,
        session,
        tier,
        why,
        base,
      });
    } finally {
      if (loading?.stop === stop) {
        loading = null;
        view.progress?.(null);
      }
    }
  };

  /**
   * Answer one of the desk's requests. A failure goes to the status line and ends the request with
   * the same words, which the desk shows in its own notice.
   * @param {string} name
   * @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const file = await load(buffer, path);
    wake.opened(buffer);
    forget(buffer);
    files.set(buffer, file);
    present(buffer);
    say(opening(file));
    await watch(file);
    await runSchema(file);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path } = requested(args);
    // A file the frame lost opens from disk, as it was shown; what the sleep kept unsaved is gone.
    if (await wake.lost(buffer, path, { edits: false })) return;
    const old = held(buffer);
    const file = await load(buffer, path ?? old.path);
    if (old.watchId) file.watchId = old.watchId;
    old.opened.remote?.close();
    files.set(buffer, file);
    if (shown === buffer) present(buffer);
    say(opening(file));
    await runSchema(file);
  });

  const editing = createEditing(
    { bridge, commands },
    {
      shown: () => (shown === null ? undefined : files.get(shown)),
      held,
      say,
      changed: async (file) => {
        if (files.get(file.buffer) !== file) return;
        if (shown === file.buffer) present(file.buffer);
        say(`Edited ${file.name}.`);
        await runSchema(file);
      },
    },
  );

  // Put to sleep while nobody sees it, Data keeps its files and comes back to them (ADR 0070).
  const wake = createWake({
    surface,
    keepFiles: options.keepFiles,
    view,
    load,
    files: () => [...files.values()],
    shown: () => shown,
    has: (buffer) => files.has(buffer),
    hold: (file, watchId) => {
      forget(file.buffer);
      files.set(file.buffer, file);
      if (watchId) {
        file.watchId = watchId;
        watches.set(watchId, file.buffer);
      } else void watch(file);
      runSchema(file).catch(() => {});
    },
    present: (file) => {
      shown = file.buffer;
      view.show(modelOf(file));
    },
    restore: editing.restore,
    marked: (buffer) => {
      commands.run("desk.buffers.update", { id: buffer, modified: false }).catch(() => {});
    },
    say,
    opening,
    busy: () => loading !== null,
  });

  answer("desk.files.save", async (args) => {
    const { buffer, path } = requested(args);
    await wake.lost(buffer, undefined);
    return editing.save(buffer, path);
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // Its file still opening as the window woke waits for it; one the frame lost opens now.
    await wake.settled(buffer);
    await wake.lost(buffer, path);
    held(buffer);
    present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    const keptOnly = wake.closed(buffer);
    if (loading?.buffer === buffer) {
      loading.stop.abort();
      if (!files.has(buffer)) return;
    }
    if (keptOnly && !files.has(buffer)) return;
    editing.closed(held(buffer).path);
    forget(buffer);
    if (shown !== buffer) return;
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    shown = null;
    view.show(null);
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const file = buffer === undefined ? undefined : files.get(buffer);
    if (!file) return;
    // Every change: desk.files.on-change decides whether the file is read again.
    commands.run("desk.files.changed", { path: file.path }).catch(() => {});
  });

  view.show(null);
  wake.start();

  const validateWith = createValidateWith(
    { bridge, commands },
    {
      current: () => (shown === null ? undefined : files.get(shown)),
      view,
      say,
      check: runSchema,
      scopeOf,
    },
  );

  return {
    validateWith,
    begin: editing.begin,
    edit: editing.edit,
    cancel() {
      loading?.stop.abort(new DOMException("Opening was cancelled.", "AbortError"));
    },
  };
}
