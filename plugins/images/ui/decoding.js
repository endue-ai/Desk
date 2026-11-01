// Decoding one file where it does not freeze the surface: in place up to 8 MiB, in a worker
// (worker.js, started with the SDK's startWorker) above that. Either way the answer is a Decoded
// whose image the webview decodes has a blob: URL, so no bytes go through base64. A volume keeps
// its worker for its other slices until close() ends it; Cancel (the signal) ends it at once.
import { decode } from "./decode.js";

/**
 * @typedef {import("./decode.js").Decoded} Decoded
 * @typedef {(url: string | URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{ signal?: AbortSignal, progress?: (done: number, total: number) => void, startWorker?: StartWorker }} Options
 */

/** Files larger than this decode in a worker. */
export const LARGE = 8 * 1024 * 1024;

const cancelled = () => new DOMException("Decoding was cancelled.", "AbortError");

/** The Decoded the controller keeps: a blob: URL for the webview, no bytes, no float copy. */
function finish(/** @type {Decoded & { blob?: Blob }} */ decoded) {
  if (decoded.kind === "web" && (decoded.blob || decoded.data))
    decoded.url = URL.createObjectURL(
      decoded.blob ?? new Blob([/** @type {BlobPart} */ (decoded.data)], { type: decoded.mime }),
    );
  delete decoded.blob;
  delete decoded.data;
  delete decoded.float;
  return decoded;
}

/** Let go of what a Decoded holds: its blob: URL and a volume's worker. */
export function release(/** @type {Decoded | undefined} */ decoded) {
  if (decoded?.url) URL.revokeObjectURL(decoded.url);
  decoded?.close?.();
}

/**
 * @param {Uint8Array} bytes the file; it moves to the worker when one decodes it
 * @param {string} name the file name or path
 * @param {Options} [options]
 * @returns {Promise<Decoded>}
 */
export async function decodeFile(bytes, name, options = {}) {
  const { signal, progress, startWorker } = options;
  signal?.throwIfAborted();
  if (bytes.length > LARGE && startWorker) {
    /** @type {Worker | undefined} */
    let worker;
    try {
      worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Images decoder" });
    } catch {
      // A desk that starts no workers still opens the file, on the main thread.
    }
    if (worker) return inWorker(worker, bytes, name, options);
  }
  const decoded = await decode(bytes, name, { progress });
  if (signal?.aborted) throw cancelled();
  return finish(decoded);
}

/**
 * @param {Worker} worker
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {Options} options
 * @returns {Promise<Decoded>}
 */
function inWorker(worker, bytes, name, { signal, progress }) {
  return new Promise((resolve, reject) => {
    /** Slices asked for and not yet answered. @type {Map<number, { resolve(rgba: Uint8ClampedArray): void, reject(error: unknown): void }>} */
    const waiting = new Map();
    let asked = 0;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      worker.terminate();
      for (const slice of waiting.values()) slice.reject(cancelled());
      waiting.clear();
    };
    const abort = () => {
      end();
      reject(cancelled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", (event) => {
      signal?.removeEventListener("abort", abort);
      end();
      reject(new Error(event.message || "The decoder stopped."));
    });
    worker.addEventListener("message", ({ data }) => {
      if (ended) return;
      if (data?.type === "progress") progress?.(data.done, data.total);
      else if (data?.type === "slice") {
        const slice = waiting.get(data.n);
        waiting.delete(data.n);
        if (data.rgba) slice?.resolve(data.rgba);
        else slice?.reject(new Error("The slice could not be decoded."));
      } else if (data?.type === "done") {
        signal?.removeEventListener("abort", abort);
        /** @type {Decoded & { blob?: Blob }} */
        const decoded = data.decoded;
        if (decoded.slices) {
          const at = (/** @type {number} */ index) =>
            new Promise((ok, no) => {
              if (ended) return no(cancelled());
              const n = ++asked;
              waiting.set(n, { resolve: ok, reject: no });
              worker.postMessage({ type: "slice", index, n });
            });
          decoded.slices = { ...decoded.slices, at };
          decoded.close = end;
        } else end();
        resolve(finish(decoded));
      }
    });
    worker.postMessage({ type: "decode", bytes, name }, [bytes.buffer]);
  });
}
