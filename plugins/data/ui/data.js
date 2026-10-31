// The data plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save, desk.buffers.show, .closed), reads files as base64 with one ask for the file's
// folder when its grants do not cover it, opens them with formats.js, follows them with fs.watch,
// checks them against their JSON Schema (schema-check.js), and tells the view what to show. It only
// talks to ctx and a view, so the SDK's test host runs it with a recording view.

import { openFile } from "./formats.js";
import { createSchemaCheck } from "./schema-check.js";
import { CHECKED, folderOf, join, nameOf, pickedKey } from "./schemas.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {import("./schema-check.js").SchemaState} SchemaState
 * @typedef {{ buffer: string, path: string, name: string, size: number, opened: Opened,
 *   schema: SchemaState, maskKeys: boolean }} Shown
 * @typedef {{ show(model: Shown | null): void, schema(buffer: string, state: SchemaState): void,
 *   mask(keys: boolean): void, status(text: string): void, focus(): void }} View
 * @typedef {Omit<Shown, "maskKeys"> & { watchId?: string }} File
 */

const NAME = "Data";

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

/** @param {string} content */
function fromBase64(content) {
  const native = /** @type {{ fromBase64?: (s: string) => Uint8Array }} */ (
    /** @type {unknown} */ (Uint8Array)
  ).fromBase64;
  if (native) return native(content);
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings">} ctx
 * @param {View} view
 * @param {import("./formats.js").OpenOptions} [options]
 */
export function createData({ bridge, commands, settings }, view, options = {}) {
  /** @type {Map<string, File>} */
  const files = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let maskKeys = true;
  let said = "";

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
    const { buffer, path, name, size, opened, schema } = file;
    return { buffer, path, name, size, opened, schema, maskKeys };
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
    files.delete(buffer);
  };

  /** Read a file's bytes. When the grants do not cover it, ask once for its folder and try again. */
  const read = async (/** @type {string} */ path, ask = true) => {
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
      if (codeOf(error) !== "permission_denied" || !ask) throw failed(error);
    }
    const reason = `To open ${path} in ${NAME}`;
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return fromBase64((await call()).content);
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
    if (!opened.doc) return `Opened ${name} as raw text. ${opened.note ?? ""}`.trim();
    const [first, ...rest] = opened.doc.errors;
    if (!first) return `Opened ${name} as ${opened.label}.`;
    const count = rest.length === 0 ? "1 parse error" : `${rest.length + 1} parse errors`;
    return `Opened ${name} as ${opened.label}: ${count}, the first at line ${first.line}.`;
  };

  const runSchema = async (/** @type {File} */ file) => {
    file.schema = await check(file);
    if (files.get(file.buffer) === file) view.schema(file.buffer, file.schema);
  };

  /** Read and open a file for its buffer. */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
    await ready;
    const bytes = await read(path);
    const name = nameOf(path);
    const opened = openFile(name, bytes, options);
    const checked = CHECKED.has(opened.format) && opened.doc !== undefined;
    /** @type {SchemaState} */
    const schema = { state: checked ? "loading" : "none", errors: [] };
    return /** @type {File} */ ({ buffer, path, name, size: bytes.length, opened, schema });
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
    forget(buffer);
    files.set(buffer, file);
    present(buffer);
    say(opening(file));
    await watch(file);
    await runSchema(file);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path } = requested(args);
    const old = held(buffer);
    const file = await load(buffer, path ?? old.path);
    if (old.watchId) file.watchId = old.watchId;
    files.set(buffer, file);
    if (shown === buffer) present(buffer);
    say(opening(file));
    await runSchema(file);
  });

  answer("desk.files.save", () => {
    throw new Error(`${NAME} opens files read-only.`);
  });

  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    present(buffer);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    held(buffer);
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

  /** "Validate with...": pick a schema with the palette, keep it for this file, and check. */
  const validateWith = async () => {
    const file = shown === null ? undefined : files.get(shown);
    if (!file) return say("Open a JSON, YAML or TOML file first.");
    if (!CHECKED.has(file.opened.format) || !file.opened.doc)
      return say(`${file.opened.label} files are not checked against a JSON Schema.`);
    const folder = folderOf(file.path);
    const listed = await bridge
      .call("fs.list", { path: folder, scope: scopeOf(file.path) })
      .catch(() => ({ entries: [] }));
    const items = listed.entries
      .filter((e) => e.kind === "file" && /\.json$/i.test(e.name) && e.name !== file.name)
      .map((e) => ({ id: `${folder}/${e.name}`, label: e.name, detail: folder }));
    let picked;
    try {
      picked = await commands.run("desk.palette.pick", {
        title: `Validate ${file.name} with which JSON Schema?`,
        items,
        free: true,
        placeholder: "~/path/to/schema.json",
      });
    } catch (error) {
      if (codeOf(error) !== "cancelled") say("Cannot ask: the palette is off.");
      return;
    }
    if (typeof picked !== "string" || picked.trim() === "") return;
    const schema = join(folder, picked.trim());
    const value = { file: file.path, schema };
    await bridge.call("store.set", { key: pickedKey(file.path), value }).catch(() => {});
    view.schema(file.buffer, { state: "loading", how: "picked", source: schema, errors: [] });
    await runSchema(file);
    const result = file.schema.state === "valid" ? "matches" : "was checked against";
    say(`${file.name} ${result} ${nameOf(schema)}.`);
  };

  return { validateWith };
}
