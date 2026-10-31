// The docs plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save refused, desk.buffers.show, .closed), reads each file with fs.read as base64, asks
// with perm.request for the file's folder when the grants do not cover it, opens it into the
// document model (or the details view) and follows it on disk. It only talks to ctx.commands,
// ctx.bridge and a view, so the SDK's test host runs it with a recording view.
import { fromBase64 } from "./bytes.js";
import { openDocument } from "./open.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {{ buffer: string, path: string, name: string, size: number, doc: import("./model.js").Opened }} Shown
 * @typedef {{ show(shown: Shown | null): unknown, status(text: string): void, focus(): void }} View
 * @typedef {Shown & { watchId?: string }} Open
 */

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

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {{ open?: typeof openDocument }} [options]
 */
export function createDocs({ bridge, commands }, view, options = {}) {
  const open = options.open ?? openDocument;
  /** @type {Map<string, Open>} */
  const docs = new Map();
  /** @type {Map<string, string>} watch id -> buffer */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";

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

  /** fs.read as base64; a refusal asks once for the file's folder and reads again. */
  const read = async (/** @type {string} */ path) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    const call = () => bridge.call("fs.read", { path, encoding: "base64", scope });
    try {
      return fromBase64((await call()).content);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Docs`,
      })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return fromBase64((await call()).content);
    } catch (error) {
      throw failed(error);
    }
  };

  /** Read and open a file; a reader's failure is the details view, never an error. */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
    const bytes = await read(path);
    const doc = await open(bytes, path).catch(() => ({
      kind: /** @type {const} */ ("details"),
      format: "unknown",
      formatName: "Unknown format",
      reason: "This file is damaged, or it is a variant Docs does not read.",
    }));
    return { buffer, path, name: nameOf(path), size: bytes.length, doc };
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
    await present(buffer);
  });

  answer("desk.buffers.closed", async (args) => {
    const { buffer } = requested(args);
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
}
