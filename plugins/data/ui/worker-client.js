// SDK worker lifecycle and small request/reply messages. Input bytes transfer, never clone.
const aborted = () => new DOMException("Opening was cancelled.", "AbortError");

/** @returns {Promise<import("./formats.js").Opened>} */
export async function openWorker(name, bytes, startWorker, options = {}) {
  if (options.signal?.aborted) throw aborted();
  const worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Data document" });
  const pending = new Map();
  let next = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const entry of pending.values()) entry.reject(aborted());
    pending.clear();
  };
  /** @returns {Promise<any>} */
  const request = (method, args = {}, transfer = []) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(aborted());
        return;
      }
      const id = ++next;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args }, transfer);
    });
  worker.addEventListener("message", async ({ data }) => {
    if (closed) return;
    if (data.progress) {
      options.onProgress?.(data.progress.done, data.progress.total);
      return;
    }
    if (data.io !== undefined) {
      try {
        const result =
          data.kind === "read"
            ? await options.read(data.args.path)
            : await options.bridge.call(data.args.method, data.args.params);
        if (!closed)
          worker.postMessage(
            { io: data.io, result },
            result instanceof Uint8Array ? [result.buffer] : [],
          );
      } catch {
        if (!closed) worker.postMessage({ io: data.io, error: "The schema could not be read." });
      }
      return;
    }
    const entry = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) entry?.reject(new Error(data.error));
    else entry?.resolve(data.result);
  });
  worker.addEventListener("error", () => {
    for (const entry of pending.values()) entry.reject(new Error("The data worker stopped."));
    close();
  });
  options.signal?.addEventListener("abort", close, { once: true });
  try {
    const meta = await request("init", { name, bytes, maskKeys: options.maskKeys }, [bytes.buffer]);
    return { ...meta, remote: { request, close } };
  } catch (error) {
    close();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", close);
  }
}
