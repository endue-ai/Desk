// The worker of a whole export's file (PG-64), started with the SDK's startWorker (pipe-client.js):
// each page of the COPY becomes the file's bytes here, off the frame's thread. One file per worker.
// It imports only relative files: import maps do not reach a module worker.
import { answerPipe } from "./pipe-client.js";

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  /** @type {{ pipe?: import("./pipe.js").Pipe }} */
  const held = {};
  globalThis.onmessage = async (event) => {
    globalThis.postMessage(await answerPipe(held, event.data));
  };
}
