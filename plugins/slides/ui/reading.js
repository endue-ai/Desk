// How Slides gets a presentation's bytes and its deck: the whole file in ranges with the SDK's
// readBytes, asking once with perm.request for the file's folder when the grants do not cover it
// (never for a window coming back from a sleep), and a large file's deck built in a worker
// (ui/worker.js) that stays while the deck is held, for its pictures.
import { imageCache } from "./deck.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./open.js").Opened} Opened
 * @typedef {typeof import("@endue-ai/plugin-sdk").startWorker} StartWorker
 */

const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
/** @type {"fs:read"} */
const FS_READ = "fs:read";
const EVERYTHING_UNDER = "/**";
/** The scope a read carries: the file's folder. @param {string} path */
export const scopeOf = (path) => ({
  permission: FS_READ,
  paths: [`${folderOf(path)}${EVERYTHING_UNDER}`],
});
export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * The whole file in ranges; when the grants do not cover it, ask once for its folder and try again,
 * unless `ask` is false (a window coming back from a sleep never asks).
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
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Slides`,
      })
      .catch(() => ({ granted: false }));
    signal.throwIfAborted();
    if (!decision.granted) throw refused;
    return await call().catch((again) => {
      if (signal.aborted) throw again;
      throw failed(again);
    });
  }
}

/**
 * Open a presentation in a worker started with the SDK's startWorker (ui/worker.js): the bytes move
 * to it (they are gone here afterwards), the deck comes back in parts, and its pictures are asked of
 * the worker, which stays until `close`. The signal ends the worker while it opens.
 * @param {Uint8Array} bytes @param {string} name
 * @param {{ signal: AbortSignal, startWorker: StartWorker }} options
 * @returns {Promise<{ opened: Opened, close(): void }>}
 */
export function openInWorker(bytes, name, { signal, startWorker }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Slides reader" });
    /** @type {Map<number, (url: string | null) => void>} */
    const asked = new Map();
    let next = 0;
    let closed = false;
    const close = () => {
      closed = true;
      worker.terminate();
      for (const answer of asked.values()) answer(null);
      asked.clear();
    };
    /** @type {any} */
    let opened;
    const abort = () => {
      close();
      reject(new DOMException("Opening was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    const settle = (/** @type {() => void} */ then) => {
      signal.removeEventListener("abort", abort);
      then();
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      close();
      settle(() => reject(new Error(event.message || "The presentation reader stopped.")));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "image") {
        asked.get(data.n)?.(data.url);
        asked.delete(data.n);
      } else if (data.type === "head") opened = data.opened;
      else if (data.type === "slides") opened.deck.slides.push(...data.items);
      else if (data.type === "failed") {
        close();
        settle(() => reject(new Error(data.message)));
      } else if (data.type === "done") {
        if (data.opened) {
          close();
          return settle(() => resolve({ opened: data.opened, close }));
        }
        opened.deck.image = imageCache(
          (id) =>
            new Promise((answer) => {
              if (closed) return answer(null);
              asked.set(++next, answer);
              worker.postMessage({ type: "image", n: next, id });
            }),
        );
        settle(() => resolve({ opened, close }));
      }
    };
    worker.postMessage({ type: "open", bytes, name }, [bytes.buffer]);
  });
}
