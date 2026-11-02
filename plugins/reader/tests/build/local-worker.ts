// The library worker on the test's own thread: library-worker.js's handler behind a Worker's
// surface, with endue.formats loaded by the vitest alias instead of its URL.
import { createLibraryHandler } from "../../ui/library-worker.js";

const LIBRARIES: Record<string, () => Promise<unknown>> = {
  djvu: () => import("@endue-ai/formats/djvu/index.js"),
  rar: () => import("@endue-ai/formats/rar/index.js"),
  sevenzip: () => import("@endue-ai/formats/sevenzip/index.js"),
};

export class LocalWorker extends EventTarget {
  terminated = false;
  #handle: (message: unknown) => Promise<void>;
  constructor(load = (kind: string) => (LIBRARIES[kind] ?? (() => Promise.reject(kind)))()) {
    super();
    this.#handle = createLibraryHandler((data: unknown) => this.#send(data), load);
    this.#send({ type: "ready" });
  }
  #send(data: unknown) {
    queueMicrotask(() => {
      if (!this.terminated) this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  postMessage(data: unknown) {
    queueMicrotask(() => void this.#handle(data));
  }
  terminate() {
    this.terminated = true;
  }
}

/** A startWorker that starts LocalWorkers and keeps them, with the URLs it was given. */
export function localWorkers(load?: (kind: string) => Promise<unknown>) {
  const started = { urls: [] as URL[], workers: [] as LocalWorker[] };
  const startWorker = (url: URL) => {
    started.urls.push(url);
    const worker = new LocalWorker(load);
    started.workers.push(worker);
    return worker;
  };
  return Object.assign(startWorker, started);
}
