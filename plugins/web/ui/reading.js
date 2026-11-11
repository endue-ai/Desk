// How Web reads and opens a file: its bytes in ranges with progress (the SDK's readBytes), asking
// once with perm.request for its folder when the grants do not cover it (never for a window coming
// back from a sleep), the files a page uses, read under the page's folder grant without ever asking,
// and the model the bytes make (formats.js, in a worker for large pages and archives).
import { detect, LABELS } from "./detect.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {{ bridge: PluginContext["bridge"], readBytes: typeof import("@endue-ai/plugin-sdk").readBytes }} Deps
 * @typedef {import("./web.js").OpenFile} OpenFile
 * @typedef {import("./web.js").Report} Report
 */

/**
 * The readers (formats.js and every format under it) and the worker's client are not part of the
 * plugin's first load: they start loading once the plugin is mounted (it says hello without them),
 * and a file waits for them only when it comes first.
 */
export const readers = () => Promise.all([import("./formats.js"), import("./remote.js")]);

/** Files over this size are opened in a worker when their format needs no DOM. */
const WORKER_OVER = 8 * 1024 * 1024;
const OFF_THREAD = new Set(["html", "xhtml", "mhtml", "webarchive", "warc", "warc.gz", "maff"]);

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

const bytesText = (/** @type {number} */ done, /** @type {number} */ total) =>
  `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes`;

/** The folder a file is in: Web asks for, and reads under, whole folders. */
export const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};

export const scopeOf = (/** @type {string} */ folder) => {
  /** @type {{ permission: "fs:read", paths: string[] }} */
  const scope = { permission: "fs:read", paths: [`${folder}/**`] };
  return scope;
};

export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * The file's bytes, in ranges with progress. A refusal asks once for its folder and reads again,
 * unless `ask` is false (a window coming back from a sleep never asks).
 * @param {Deps} deps
 * @param {string} path
 * @param {{ signal: AbortSignal, onProgress: (done: number, total: number) => void, ask: boolean }} how
 */
export async function readWhole({ bridge, readBytes }, path, { signal, onProgress, ask }) {
  const scope = scopeOf(folderOf(path));
  const refused = new Error(`Not allowed to read ${path}.`);
  const call = () => readBytes({ bridge }, { path, scope }, { signal, onProgress });
  const failed = (/** @type {unknown} */ error) => {
    if (signal.aborted) return error;
    return codeOf(error) === "permission_denied"
      ? refused
      : new Error(`Could not read ${path}: ${codeOf(error)}.`);
  };
  try {
    return await call();
  } catch (error) {
    if (signal.aborted || codeOf(error) !== "permission_denied" || !ask) throw failed(error);
  }
  // perm.request answers a refusal as a result; a failed ask counts as one.
  const decision = await bridge
    .call("perm.request", {
      permission: /** @type {Permission} */ (scope),
      reason: `To open ${path} in Web`,
    })
    .catch(() => ({ granted: false }));
  signal.throwIfAborted();
  if (!decision.granted) throw refused;
  try {
    return await call();
  } catch (error) {
    throw failed(error);
  }
}

/**
 * A file a page uses, read under the page's folder grant; never asks. Null when it cannot.
 * @param {Deps} deps
 * @param {string} page
 * @param {AbortSignal} signal
 */
export const resourceOf =
  ({ bridge, readBytes }, page, signal) =>
  async (/** @type {string} */ path) => {
    const folder = folderOf(page);
    const scope = scopeOf(path.startsWith(`${folder}/`) ? folder : folderOf(path));
    try {
      return await readBytes({ bridge }, { path, scope }, { signal });
    } catch {
      return null;
    }
  };

/**
 * Read a file and turn it into a model: in a worker when it is large and needs no DOM.
 * @param {Deps & { startWorker?: import("./remote.js").StartWorker, workerOver?: number }} deps
 * @param {string} buffer
 * @param {string} path
 * @param {{ signal: AbortSignal, report: Report, ask: boolean }} how
 * @returns {Promise<OpenFile>}
 */
export async function loadFile(deps, buffer, path, { signal, report, ask }) {
  const { bridge, readBytes, startWorker, workerOver = WORKER_OVER } = deps;
  const name = nameOf(path);
  report("Reading", null, 1, name);
  const bytes = await readWhole({ bridge, readBytes }, path, {
    signal,
    onProgress: (done, total) => report("Reading", done, total, bytesText(done, total)),
    ask,
  });
  const size = bytes.length;
  const [{ openFile }, { NoWorker, openInWorker }] = await readers();
  signal.throwIfAborted();
  const disk = { read: resourceOf({ bridge, readBytes }, path, signal) };
  const format = detect(bytes, path);
  /** @type {OpenFile} */
  const file = { buffer, path, name, size, model: { kind: "details", format: "", reason: "" } };
  if (startWorker && size > workerOver && OFF_THREAD.has(format)) {
    report("Opening", null, 1, name);
    try {
      const opened = await openInWorker(bytes, path, { startWorker, disk, signal });
      return Object.assign(file, opened);
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof NoWorker)) {
        const reason = error instanceof Error ? error.message : String(error);
        file.model = {
          kind: "details",
          format: LABELS[format],
          reason: `Web could not open it: ${reason}`,
        };
        return file;
      }
    }
  }
  file.model = await openFile(bytes, path, disk);
  return file;
}
