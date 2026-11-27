export function createClient(startWorker) {
  let worker;
  let next = 0;
  const waiting = new Map();
  function close(error) {
    worker?.terminate();
    worker = undefined;
    for (const { reject } of waiting.values()) reject(error);
    waiting.clear();
  }
  function connect() {
    const instance = startWorker(new URL("./worker.js", import.meta.url), { name: "image-studio" });
    instance.addEventListener("message", ({ data: { id, result, error } }) => {
      const request = waiting.get(id);
      if (!request) return;
      waiting.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    });
    instance.addEventListener("error", () =>
      close(new Error("The image worker stopped. Reopen the image to retry.")),
    );
    return instance;
  }
  return {
    connected: () => Boolean(worker),
    call(request, transfer = []) {
      worker ??= connect();
      return new Promise((resolve, reject) => {
        const id = ++next;
        worker.postMessage({ id, request }, transfer);
        waiting.set(id, { resolve, reject });
      });
    },
    reset() {
      close(new Error("The image was closed."));
    },
  };
}
