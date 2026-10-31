// The sheets plugin without its DOM. It answers the desk's file and buffer requests
// (desk.files.visit, .save, .revert, desk.buffers.show, .closed) for the spreadsheets it holds,
// reads them as base64 with fs.read, asks with perm.request for a folder its grants do not cover,
// follows each file on disk, and reads CSV again when the csv-encoding setting changes. It only
// talks to ctx.commands, ctx.bridge, ctx.settings and a view, so the SDK's test host runs it.
import { failure, openBook } from "./book.js";
import { ENCODINGS } from "./csv.js";
import { extensionOf } from "./detect.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./book.js").Book} Book
 * @typedef {{ buffer: string, path: string, name: string, size: number, book: Book }} Shown
 * @typedef {(bytes: Uint8Array, file: { name: string, encoding: string }) => Book} Open
 * @typedef {{ show(model: Shown | null): void, status(text: string): void, focus(): void }} View
 * @typedef {Shown & { bytes?: Uint8Array, watchId?: string }} Held
 */

export const NAME = "Sheets";
const SETTING = "csv-encoding";
/** Files larger than this say "Opening" before the parser starts. */
const LARGE = 512 * 1024;
/** Formats whose text depends on the csv-encoding setting: their bytes are kept to read again. */
const TEXT = new Set(["csv", "tsv"]);

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/**
 * The scope an fs call carries: the file's whole folder, as the manifest would write it.
 * @param {string} path
 * @returns {{ permission: "fs:read", paths: string[] }}
 */
const scopeOf = (path) => {
  const folder = folderOf(path);
  return { permission: "fs:read", paths: [`${folder}/**`] };
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
function summary(/** @type {Shown} */ { name, book }) {
  if (book.kind === "details") return book.reason;
  if (book.kind === "link") return `${name} is a Google Sheets shortcut.`;
  const n = book.sheets.length;
  return `Opened ${name}: ${n} sheet${n === 1 ? "" : "s"}.`;
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings">} ctx
 * @param {View} view
 * @param {{ open?: Open }} [options]
 */
export function createSheets({ bridge, commands, settings }, view, { open = openBook } = {}) {
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
    const { buffer, path, name, size, book } = held;
    return { buffer, path, name, size, book };
  };
  const render = () => view.show(model(shown === null ? undefined : files.get(shown)));
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

  /** Read a whole file; when the grants do not cover it, ask once for its folder and try again. */
  const read = async (/** @type {string} */ path) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = () => bridge.call("fs.read", { path, encoding: "base64", scope });
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    let answer;
    try {
      answer = await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
      // perm.request answers a refusal as a result; a failed ask counts as one.
      const reason = `To open ${path} in ${NAME}`;
      const decision = await bridge
        .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
        .catch(() => ({ granted: false }));
      if (!decision.granted) throw refused;
      answer = await call().catch((again) => {
        throw failed(again);
      });
    }
    return answer.encoding === "base64"
      ? bytesOf(answer.content)
      : new TextEncoder().encode(answer.content);
  };

  /** Parse without ever throwing: what cannot be read is a details view. */
  const parse = (/** @type {Uint8Array} */ bytes, /** @type {string} */ name) => {
    try {
      return open(bytes, { name, encoding });
    } catch (error) {
      return failure(bytes, name, error);
    }
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

  const loaded = (async () => {
    const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
    const own = await settings.get(SETTING).catch(() => undefined);
    const values = /** @type {Record<string, unknown> | undefined} */ (init.settings);
    const fromInit = values?.[`endue.sheets.${SETTING}`];
    encoding = encodingOf(own ?? fromInit);
  })();

  /** Read a file into its buffer, replacing what the buffer held. */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
    const bytes = await read(path);
    await loaded;
    const name = nameOf(path);
    if (bytes.length > LARGE) {
      // The parser holds the frame while it works: say so first, and let the frame paint it.
      say(`Opening ${name}…`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    /** @type {Held} */
    const file = { buffer, path, name, size: bytes.length, book: parse(bytes, name) };
    if (TEXT.has(extensionOf(name))) file.bytes = bytes;
    return file;
  };

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const file = await load(buffer, path);
    forget(buffer);
    files.set(buffer, file);
    present(buffer);
    await watch(file);
    return summary(file);
  });

  answer("desk.files.revert", async (args) => {
    const { buffer, path } = requested(args);
    const before = held(buffer);
    const file = await load(buffer, path ?? before.path);
    if (files.get(buffer) !== before) return "";
    Object.assign(before, { ...file, watchId: before.watchId });
    if (!file.bytes) delete before.bytes;
    if (shown === buffer) render();
    return summary(before);
  });

  answer("desk.files.save", () => {
    throw new Error(`${NAME} opens files read-only.`);
  });

  answer("desk.buffers.show", (args) => {
    const file = held(requested(args).buffer);
    present(file.buffer);
    // The desk shows a file right after its visit: the status line keeps saying what it is.
    return summary(file);
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
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
    for (const file of files.values()) {
      if (file.bytes) file.book = parse(file.bytes, file.name);
    }
    render();
  });

  render();
}
