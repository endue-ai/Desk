// The software player's worker: started with the SDK's startWorker (main.js passes it in), opened on
// the file's URL, which it reads by ranges. When the worker answers that it cannot read that URL, the
// whole file is read once here and a new worker opens it from memory.

/**
 * @typedef {{ startWorker: () => Worker, wasm: string, url: string, size: number, video: boolean,
 *   audio: boolean, readAll?: () => Promise<ArrayBuffer> }} LinkOptions
 * @typedef {{ message(data: any): void, reopen(): void, fail(words: string): void }} LinkEvents
 */

const words = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {LinkOptions} options
 * @param {LinkEvents} on
 */
export function createLink(options, on) {
  /** @type {Worker | null} */
  let worker = null;
  let tried = false;
  let closed = false;

  const start = (/** @type {ArrayBuffer | undefined} */ bytes) => {
    const started = options.startWorker();
    worker = started;
    started.addEventListener("message", (event) => {
      if (started !== worker || closed) return;
      const data = event.data;
      if (data?.type === "error" && data.code === "read" && !tried && options.readAll) refetch();
      else on.message(data);
    });
    started.addEventListener("error", () => {
      if (started === worker && !closed) on.fail("The software decoder could not start.");
    });
    const { wasm, size, video, audio, url } = options;
    const open = { type: "open", wasm, size, video, audio };
    if (bytes) started.postMessage({ ...open, bytes }, [bytes]);
    else started.postMessage({ ...open, url });
  };

  const refetch = () => {
    tried = true;
    worker?.terminate();
    worker = null;
    const readAll = /** @type {() => Promise<ArrayBuffer>} */ (options.readAll);
    readAll().then(
      (bytes) => {
        if (closed) return;
        on.reopen();
        start(bytes);
      },
      (error) => {
        if (!closed) on.fail(words(error));
      },
    );
  };

  start();
  return {
    post(/** @type {object} */ data) {
      worker?.postMessage(data);
    },
    /** End the worker after a failure; nothing more is heard from it. */
    stop() {
      worker?.terminate();
      worker = null;
    },
    close() {
      if (closed) return;
      closed = true;
      worker?.postMessage({ type: "close" });
      worker?.terminate();
      worker = null;
    },
  };
}
