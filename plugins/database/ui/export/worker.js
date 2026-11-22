// The export's worker (PG-61), started with the SDK's startWorker (client.js): a large result's file
// is written here, off the frame's thread. It imports only relative files: import maps do not reach
// a module worker.
import { answerJob } from "./file.js";

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = async (event) => {
    globalThis.postMessage(await answerJob(event.data));
  };
}
