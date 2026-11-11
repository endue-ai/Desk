// Opening one file at a time: read it whole in bounded binary ranges (asking once for its folder when
// the grants do not cover it, unless the window is coming back from a sleep), parse it in isolation
// with progress after a moment, and show the first sheets as a preview while the rest parse. A new
// opening, a show or a close cancels the one underway; a cancelled or failed one puts back what
// was on screen.
import { failure } from "./errors.js";

/**
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./sheets.js").Shown} Shown
 * @typedef {import("./sheets.js").View} View
 * @typedef {import("./sheets.js").Open} Open
 * @typedef {import("./book.js").Book} Book
 * @typedef {{ buffer: string, path: string, name: string, size: number, book: Book, focused: boolean }} Loaded
 *   focused: the preview took the focus
 * @typedef {{ preview?: boolean, focus?: boolean, ask?: boolean }} How preview: show the first
 *   sheets while the rest parse; focus: the preview takes the focus; ask: a refused read asks
 */

export const NAME = "Sheets";

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
export const scopeOf = (path) => {
  const folder = folderOf(path);
  return { permission: "fs:read", paths: [`${folder}/**`] };
};
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const count = (/** @type {number} */ n) => n.toLocaleString("en-US");

/**
 * @param {{
 *   bridge: import("@endue-ai/plugin-sdk").PluginContext["bridge"], view: View,
 *   open: Open, readBytes: typeof import("@endue-ai/plugin-sdk").readBytes,
 *   say(text: string): void, render(): void, onScreen(): Shown | null,
 *   ready: Promise<unknown>, encoding(): string,
 * }} deps onScreen: what the view shows now; ready: the settings are read
 */
export function createLoading({
  bridge,
  view,
  open,
  readBytes,
  say,
  render,
  onScreen,
  ready,
  encoding,
}) {
  /** @type {AbortController | undefined} */
  let opening;
  /** @type {string | undefined} */
  let openingBuffer;

  /** Cancel the opening underway; resolves with its buffer, if there was one. */
  const stop = () => {
    const buffer = openingBuffer;
    opening?.abort();
    opening = undefined;
    openingBuffer = undefined;
    view.progress?.(null);
    if (buffer !== undefined) render();
    return buffer;
  };

  /** Read a whole file; when the grants do not cover it, ask once for its folder and try again. */
  const read = async (
    /** @type {string} */ path,
    /** @type {AbortSignal} */ signal,
    /** @type {(done: number, total: number) => void} */ onProgress,
    ask = true,
  ) => {
    const scope = scopeOf(path);
    const refused = new Error(`Not allowed to read ${path}.`);
    const call = () => readBytes({ bridge }, { path, scope }, { signal, onProgress });
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    try {
      return await call();
    } catch (error) {
      if (signal.aborted) throw error;
      if (codeOf(error) !== "permission_denied" || !ask) throw failed(error);
    }
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const reason = `To open ${path} in ${NAME}`;
    const decision = await bridge
      .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
      .catch(() => ({ granted: false }));
    signal.throwIfAborted();
    if (!decision.granted) throw refused;
    return call().catch((again) => {
      throw failed(again);
    });
  };

  /**
   * Read and parse in isolation. A partial book is a preview until the whole operation commits.
   * @param {string} buffer
   * @param {string} path
   * @param {How} [how]
   * @returns {Promise<Loaded>}
   */
  const load = async (buffer, path, { preview = true, focus = true, ask = true } = {}) => {
    stop();
    const job = new AbortController();
    opening = job;
    openingBuffer = buffer;
    const name = nameOf(path);
    const previous = onScreen();
    let first = false;
    let size = 0;
    const report = (label, value, max, detail) => {
      if (opening === job && !first)
        view.progress?.({ label, value, max, detail, cancel: () => job.abort() });
    };
    report("Reading", null, 1, name);
    say(`Opening ${name}…`);
    try {
      const bytes = await read(
        path,
        job.signal,
        (done, total) => report("Reading", done, total, `${count(done)} of ${count(total)} bytes`),
        ask,
      );
      size = bytes.length;
      // Keep only the signature for a worker error: ownership of the file goes to the worker.
      const signature = bytes.slice(0, 512);
      await ready;
      job.signal.throwIfAborted();
      report("Parsing", null, 1, name);
      let book;
      try {
        book = await open(
          bytes,
          { name, encoding: encoding() },
          {
            signal: job.signal,
            progress: (done, total) =>
              report("Parsing", done, total, `${count(done)} of ${count(total)} rows`),
            sheet: (book) => {
              if (opening !== job || job.signal.aborted || !preview) return;
              view.show({ buffer, path, name, size, book });
              if (!first && focus) view.focus();
              first = true;
              view.progress?.(null);
            },
          },
        );
      } catch (error) {
        if (job.signal.aborted) throw error;
        book = failure(signature, name, error);
      }
      job.signal.throwIfAborted();
      return { buffer, path, name, size, book, focused: first && focus };
    } catch (error) {
      if (opening === job) view.show(previous);
      if (job.signal.aborted) throw new Error(`Opening ${name} was cancelled.`);
      throw error;
    } finally {
      if (opening === job) {
        opening = undefined;
        openingBuffer = undefined;
        view.progress?.(null);
      }
    }
  };

  return { load, stop, opening: () => openingBuffer };
}
