/** Await initialization with the same ownership signal after the ready event. */
async function initialized(promise, signal) {
  signal?.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

// A pdf.js worker belongs to one open document. Wait for its actual ready message: a successful
// Worker constructor alone does not prove that the vendored module can load under this CSP.
export async function createPdfWorker(lib, startWorker, { fallback, signal } = {}) {
  let port;
  let worker;
  try {
    signal?.throwIfAborted();
    port = startWorker(new URL("./vendor/pdf.worker.min.mjs", import.meta.url), {
      name: "reader-pdf",
    });
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        port.removeEventListener("message", ready);
        port.removeEventListener("error", failed);
        signal?.removeEventListener("abort", abort);
      };
      const ready = ({ data }) => {
        if (
          data?.sourceName !== "worker" ||
          data?.targetName !== "main" ||
          data?.action !== "ready"
        )
          return;
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("The PDF worker could not start."));
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      port.addEventListener("message", ready);
      port.addEventListener("error", failed);
      signal?.addEventListener("abort", abort, { once: true });
    });
    worker = lib.PDFWorker.create({ port });
    await initialized(worker.promise, signal);
  } catch (error) {
    port?.terminate();
    port = undefined;
    worker?.destroy();
    if (signal?.aborted) throw error;
    await fallback();
    signal?.throwIfAborted();
    worker = lib.PDFWorker.create({});
    try {
      await initialized(worker.promise, signal);
    } catch (error) {
      worker.destroy();
      throw error;
    }
  }
  let closed = false;
  return {
    worker,
    close() {
      if (closed) return;
      closed = true;
      worker.destroy();
      port?.terminate();
    },
  };
}
