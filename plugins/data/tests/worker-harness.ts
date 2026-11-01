import { MessageChannel } from "node:worker_threads";
import { attachDataWorker } from "../ui/worker.js";

/** The browser worker API over real structured-clone messages, with no browser process. */
export function workerHarness() {
  const messages: unknown[] = [];
  const workers: Worker[] = [];
  let stopped = 0;
  const start = () => {
    const { port1, port2 } = new MessageChannel();
    attachDataWorker(port2);
    port1.addEventListener("message", (event) => messages.push(event.data));
    port1.start();
    const worker = {
      postMessage: port1.postMessage.bind(port1),
      addEventListener: port1.addEventListener.bind(port1),
      removeEventListener: port1.removeEventListener.bind(port1),
      terminate() {
        stopped++;
        port1.close();
        port2.close();
      },
    } as unknown as Worker;
    workers.push(worker);
    return worker;
  };
  return {
    start,
    messages,
    workers,
    stopped: () => stopped,
    close: () => workers.forEach((worker) => worker.terminate()),
  };
}
