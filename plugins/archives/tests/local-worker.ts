// The library worker on the test's own thread: library-worker.js's handler behind a Worker's
// surface, with endue.formats loaded by the vitest alias instead of its URL. It keeps every message
// the frame sent, so tests can tell which operations ran.
import { createLibraryHandler } from "../ui/library-worker.js";

const FOLDERS: Record<string, () => Promise<unknown>> = {
  rar: () => import("@endue-ai/formats/rar/index.js"),
  disk: () => import("@endue-ai/formats/disk/index.js"),
  apple: () => import("@endue-ai/formats/apple/index.js"),
  packs: () => import("@endue-ai/formats/packs/index.js"),
};

export type Load = (folder: string) => Promise<unknown>;

export class LocalWorker extends EventTarget {
  terminated = false;
  /** Every message the frame posted. */
  received: Array<{ type: string; [key: string]: unknown }> = [];
  #handle: (message: unknown) => Promise<void>;
  constructor(load: Load = (folder) => (FOLDERS[folder] ?? (() => Promise.reject(folder)))()) {
    super();
    this.#handle = createLibraryHandler((data: unknown) => this.#send(data), load);
    this.#send({ type: "ready" });
  }
  #send(data: unknown) {
    queueMicrotask(() => {
      if (!this.terminated) this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  postMessage(data: { type: string }) {
    this.received.push(data);
    queueMicrotask(() => void this.#handle(data));
  }
  terminate() {
    this.terminated = true;
  }
  /** The operations the frame asked for, in order (reads answered are left out). */
  get asked() {
    return this.received.map((m) => m.type).filter((t) => t !== "bytes" && t !== "visited");
  }
}

/** A startWorker that starts LocalWorkers and keeps them, with the URLs it was given. */
export function localWorkers(load?: Load) {
  const started = { urls: [] as URL[], workers: [] as LocalWorker[] };
  const startWorker = (url: string | URL) => {
    started.urls.push(new URL(url));
    const worker = new LocalWorker(load);
    started.workers.push(worker);
    return worker as unknown as Worker;
  };
  return Object.assign(startWorker, started);
}
