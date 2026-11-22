// The map's worker (PG-46), started with the SDK's startWorker (client.js): a spatial column's
// values are read, simplified and drawn here, off the frame's thread, and each view comes back as
// a bitmap. It imports only relative files: import maps do not reach a module worker.
import { createEngine } from "./engine.js";

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  const engine = createEngine();
  globalThis.onmessage = (event) => {
    const { reply, transfer } = engine.answer(event.data);
    globalThis.postMessage(reply, { transfer });
  };
}
