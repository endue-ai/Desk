// Opening one file: its bytes through the SDK's readBytes (ranges, with progress), one ask for its
// folder when the grants do not cover it, then decoding (decoding.js). One opening runs at a time:
// a new one, or Cancel on the progress bar, stops the read and ends the decoding worker, and the
// image on screen stays as it was.
import { decodeFile, release } from "./decoding.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./decode.js").Decoded} Decoded
 * @typedef {import("./decoding.js").StartWorker} StartWorker
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{ progress?(value: Progress | null): void }} ProgressView
 * @typedef {{ read: typeof import("@endue-ai/plugin-sdk").readBytes, startWorker?: StartWorker }} Options
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/** The scope a read carries: the file's whole folder, so one ask covers its neighbours too. */
export function scopeOf(/** @type {string} */ path) {
  /** @type {{ permission: "fs:read", paths: string[] }} */
  const scope = { permission: "fs:read", paths: [`${folderOf(path)}/**`] };
  return scope;
}
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const counted = (
  /** @type {number} */ done,
  /** @type {number} */ total,
  /** @type {string} */ unit,
) => `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${unit}`;

/**
 * @param {Pick<PluginBridge, "call">} bridge
 * @param {ProgressView} view
 * @param {Options} options
 */
export function createOpening(bridge, view, { read: readBytes, startWorker }) {
  /** @type {AbortController | undefined} */
  let job;
  /** @type {string | undefined} */
  let jobBuffer;

  /** The whole file; a refusal asks once for the file's folder and reads again. */
  const read = async (
    /** @type {string} */ path,
    /** @type {AbortSignal} */ signal,
    /** @type {(done: number, total: number) => void} */ onProgress,
  ) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = () => readBytes({ bridge }, { path, scope }, { signal, onProgress });
    const failed = (/** @type {unknown} */ e) =>
      codeOf(e) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(e)}.`);
    try {
      return await call();
    } catch (error) {
      if (signal.aborted) throw error;
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Images`,
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
  };

  /** Stop the opening in progress; answers the buffer it was for. */
  const stop = () => {
    const buffer = jobBuffer;
    job?.abort();
    job = undefined;
    jobBuffer = undefined;
    view.progress?.(null);
    return buffer;
  };

  return {
    /** The buffer being opened, if any. */
    pending: () => jobBuffer,
    stop,
    /**
     * Read and decode one file. Decoding never throws: a file it cannot show is a details view;
     * a stopped opening throws `Opening <name> was cancelled.`
     * @param {string} buffer
     * @param {string} path
     * @returns {Promise<{ size: number, decoded: Decoded }>}
     */
    async load(buffer, path) {
      stop();
      const mine = new AbortController();
      job = mine;
      jobBuffer = buffer;
      const name = nameOf(path);
      const report = (
        /** @type {string} */ label,
        /** @type {number | null} */ value,
        /** @type {number} */ max,
        /** @type {string} */ detail,
      ) => {
        if (job === mine)
          view.progress?.({ label, value, max, detail, cancel: () => mine.abort() });
      };
      try {
        report("Reading", null, 1, name);
        const bytes = await read(path, mine.signal, (done, total) =>
          report("Reading", done, total, counted(done, total, "bytes")),
        );
        mine.signal.throwIfAborted();
        const size = bytes.length;
        report("Decoding", null, 1, name);
        const decoded = await decodeFile(bytes, path, {
          signal: mine.signal,
          startWorker,
          progress: (done, total) => report("Decoding", done, total, counted(done, total, "rows")),
        });
        if (mine.signal.aborted) {
          release(decoded);
          mine.signal.throwIfAborted();
        }
        return { size, decoded };
      } catch (error) {
        if (mine.signal.aborted) throw new Error(`Opening ${name} was cancelled.`);
        throw error;
      } finally {
        if (job === mine) {
          job = undefined;
          jobBuffer = undefined;
          view.progress?.(null);
        }
      }
    },
  };
}
