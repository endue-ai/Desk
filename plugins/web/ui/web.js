// The web plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, desk.buffers.show, .closed; .save is refused), reads each file with fs.read as base64,
// asks with perm.request for a folder its grants do not cover, turns the bytes into a model
// (formats.js) and reads the files a page uses from the page's folder. It only talks to
// ctx.commands, ctx.bridge and a view, so the SDK's test host runs it with a recording view.
import { fromBase64 } from "./bytes.js";
import { openFile } from "./formats.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./formats.js").Model} Model
 * @typedef {{ buffer: string, path: string, name: string, size: number, model: Model }} Shown
 * @typedef {{ show(file: Shown | null): unknown, status(text: string): void, focus(): void }} View
 * @typedef {Shown & { watchId?: string }} OpenFile
 */

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
 */
export function createWeb({ bridge, commands }, view) {
  /** Open files by the buffer the desk named them with. @type {Map<string, OpenFile>} */
  const files = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };

  const render = async () => {
    const file = shown === null ? undefined : files.get(shown);
    if (!file) return view.show(null);
    const { buffer, path, name, size, model } = file;
    await view.show({ buffer, path, name, size, model });
  };
  const present = async (/** @type {string} */ buffer) => {
    shown = buffer;
    await render();
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

  /** The file's bytes. A refusal asks once for its folder and reads again. */
  const read = async (/** @type {string} */ path) => {
    const scope = scopeOf(folderOf(path));
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = async () =>
      fromBase64((await bridge.call("fs.read", { path, encoding: "base64", scope })).content);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    try {
      return await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Web`,
      })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call();
    } catch (error) {
      throw failed(error);
    }
  };

  /** A file a page uses, read under the page's folder grant; never asks. Null when it cannot. */
  const resource = (/** @type {string} */ page) => async (/** @type {string} */ path) => {
    const folder = folderOf(page);
    const scope = scopeOf(path.startsWith(`${folder}/`) ? folder : folderOf(path));
    try {
      return fromBase64(
        (await bridge.call("fs.read", { path, encoding: "base64", scope })).content,
      );
    } catch {
      return null;
    }
  };

  /** @param {string} buffer @param {string} path @returns {Promise<OpenFile>} */
  const load = async (buffer, path) => {
    const bytes = await read(path);
    const model = await openFile(bytes, path, { read: resource(path) });
    return { buffer, path, name: nameOf(path), size: bytes.length, model };
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
    const file = await load(buffer, path);
    forget(buffer);
    files.set(buffer, file);
    await present(buffer);
    await watch(file);
  });

  answer("desk.files.save", () => {
    throw new Error("Web opens files read-only.");
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const file = held(buffer);
    const fresh = await load(buffer, asked ?? file.path);
    file.model = fresh.model;
    file.size = fresh.size;
    if (shown === buffer) await render();
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
    say,
  };
}
