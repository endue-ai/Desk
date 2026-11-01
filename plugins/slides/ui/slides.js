// The slides plugin without its DOM. It answers the desk's file and buffer requests (desk.files.visit,
// .revert, .save, desk.buffers.show, .closed) for the presentations it holds, reads them with fs.read
// as base64, asks with perm.request for a file its grants do not cover, and follows each file on disk.
// It only talks to ctx.commands, ctx.bridge and a view, so the SDK's test host runs it.
import { fromBase64 } from "./bytes.js";
import { openFile } from "./open.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./open.js").Opened} Opened
 * @typedef {{ buffer: string, path: string, name: string, size: number, opened: Opened }} Shown
 * @typedef {{ show(model: Shown | null): void, status(text: string): void, focus(): void }} View
 * @typedef {Shown & { watchId?: string }} OpenFile
 */

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
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 */
export function createSlides({ bridge, commands }, view) {
  /** @type {Map<string, OpenFile>} */
  const files = new Map();
  /** @type {Map<string, string>} */
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
    files.delete(buffer);
  };

  /** Read a file as bytes; when the grants do not cover it, ask once for its folder and try again. */
  const read = async (/** @type {string} */ path) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    const call = () => bridge.call("fs.read", { path, encoding: "base64", scope });
    let result;
    try {
      result = await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
      const decision = await bridge
        .call("perm.request", {
          permission: /** @type {Permission} */ (scope),
          reason: `To open ${path} in Slides`,
        })
        .catch(() => ({ granted: false }));
      if (!decision.granted) throw refused;
      result = await call().catch((again) => {
        throw failed(again);
      });
    }
    return result.encoding === "base64"
      ? fromBase64(result.content)
      : new TextEncoder().encode(result.content);
  };

  /** Read and open a file; a reader's failure is a details view, never an error. */
  const load = async (/** @type {string} */ path) => {
    const bytes = await read(path);
    /** @type {Opened} */
    const opened = await openFile(bytes, nameOf(path)).catch((error) => ({
      kind: /** @type {const} */ ("details"),
      format: "Unknown format",
      reason: `The file could not be read (${error instanceof Error ? error.message : error}).`,
    }));
    return { size: bytes.length, opened };
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
    const { size, opened } = await load(path);
    forget(buffer);
    /** @type {OpenFile} */
    const file = { buffer, path, name: nameOf(path), size, opened };
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
    const { size, opened } = await load(asked ?? file.path);
    Object.assign(file, { size, opened });
    if (shown === buffer) render();
    return summary(file.name, opened);
  });

  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    const file = held(buffer);
    present(buffer);
    return summary(file.name, file.opened);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
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
}
