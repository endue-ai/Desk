// How Docs gets a document's bytes and its model: the whole file in ranges with the SDK's readBytes,
// asking once with perm.request for the file's folder when the grants do not cover it (never for a
// window coming back from a sleep), and a large file's model built in a worker (ui/worker.js).

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./model.js").Opened} Opened
 * @typedef {typeof import("@endue-ai/plugin-sdk").startWorker} StartWorker
 */

const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/** The scope a read carries: the file's whole folder, as the person is asked for it. */
export const scopeOf = (/** @type {string} */ path) => {
  /** @type {{ permission: "fs:read", paths: string[] }} */
  const scope = { permission: "fs:read", paths: [`${folderOf(path)}/**`] };
  return scope;
};
export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * The whole file in ranges; a refusal asks once for the file's folder and reads again, unless `ask`
 * is false (a window coming back from a sleep never asks).
 * @param {{ bridge: PluginContext["bridge"], readBytes: typeof import("@endue-ai/plugin-sdk").readBytes }} deps
 * @param {string} path
 * @param {{ signal: AbortSignal, onProgress: (done: number, total: number) => void, ask: boolean }} how
 */
export async function readWhole({ bridge, readBytes }, path, { signal, onProgress, ask }) {
  const scope = scopeOf(path);
  const refused = new Error(`Not allowed to read ${path}.`);
  const failed = (/** @type {unknown} */ error) =>
    codeOf(error) === "permission_denied"
      ? refused
      : new Error(`Could not read ${path}: ${codeOf(error)}.`);
  const call = () => readBytes({ bridge }, { path, scope }, { signal, onProgress });
  try {
    return await call();
  } catch (error) {
    if (signal.aborted) throw error;
    if (codeOf(error) !== "permission_denied" || !ask) throw failed(error);
  }
  const decision = await bridge
    .call("perm.request", {
      permission: /** @type {Permission} */ (scope),
      reason: `To open ${path} in Docs`,
    })
    .catch(() => ({ granted: false }));
  signal.throwIfAborted();
  if (!decision.granted) throw refused;
  try {
    return await call();
  } catch (error) {
    if (signal.aborted) throw error;
    throw failed(error);
  }
}

/**
 * Open a document in a worker started with the SDK's startWorker (ui/worker.js): the bytes move to
 * it (they are gone here afterwards) and the model comes back in parts. The signal ends the worker.
 * @param {Uint8Array} bytes @param {string} path
 * @param {{ signal: AbortSignal, startWorker: StartWorker }} options
 * @returns {Promise<Opened>}
 */
export function openInWorker(bytes, path, { signal, startWorker }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Docs reader" });
    /** @type {any} */
    let doc;
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Opening was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish();
      reject(new Error(event.message || "The document reader stopped."));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "head") doc = data.doc;
      else if (data.type === "part") {
        const list = typeof data.at === "number" ? doc.sections[data.at].blocks : doc[data.at];
        for (const item of data.items) list.push(item);
      } else if (data.type === "failed" || data.type === "done") {
        finish();
        if (data.type === "failed") reject(new Error(data.message));
        else resolve(data.doc ?? doc);
      }
    };
    worker.postMessage({ bytes, path }, [bytes.buffer]);
  });
}
