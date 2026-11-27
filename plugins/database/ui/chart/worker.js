// The chart's worker (PG-44), started with the SDK's startWorker (client.js): a large selection's
// totals and a large result's chart are counted here, off the frame's thread. It imports only
// relative files: import maps do not reach a module worker.
import { createChartEngine } from "./engine.js";

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  const engine = createChartEngine();
  globalThis.onmessage = (event) => {
    let reply;
    try {
      reply = engine.answer(event.data);
    } catch (error) {
      reply = { id: event.data?.id, error: error instanceof Error ? error.message : String(error) };
    }
    globalThis.postMessage(reply);
  };
}
