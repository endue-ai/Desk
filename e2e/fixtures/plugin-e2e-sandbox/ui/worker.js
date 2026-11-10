// e2e.sandbox's worker, started with the SDK's startWorker: it compiles WebAssembly and fetches a
// file of the plugin's own from its desk-plugin origin, then answers the page.
import { scheme, wasm } from "./checks.js";

self.addEventListener("message", async () => {
  try {
    const [sum, file] = await Promise.all([wasm(), scheme(import.meta.url)]);
    self.postMessage({ ok: true, text: `${sum}, ${file}` });
  } catch (error) {
    self.postMessage({ ok: false, text: String(error?.message ?? error) });
  }
});
