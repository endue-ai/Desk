// startWorker for Node, as the plugin's tests use it: the parse worker's module in a worker thread
// behind a page Worker's surface, so the work is timed across the thread as the console asks it.
import { Worker } from "node:worker_threads";

const THREAD = new URL("../../../plugins/database/tests/parse-worker-thread.mjs", import.meta.url);

export function threadWorker(url: URL) {
  const thread = new Worker(THREAD, { workerData: { url: url.href } });
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string }) => void) | null,
    postMessage: (message: unknown) => thread.postMessage(message),
    terminate: () => void thread.terminate(),
  };
  thread.on("message", (data) => worker.onmessage?.({ data }));
  thread.on("error", (error: Error) => worker.onerror?.({ message: error.message }));
  return worker as unknown as globalThis.Worker;
}
