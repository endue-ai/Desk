// The app e2e's sandbox fixture (e2e/specs/sandbox.spec.ts). On mount it runs what a plugin does in
// its renderer: a bridge call, a file of its own over desk-plugin, WebAssembly, a worker (which
// compiles WebAssembly and fetches too) and a WebGPU compute pass. The button asks for
// ~/sandbox-fixture, then reads bytes 4-11 of range.bin through its fs.url URL with a Range request,
// as the SDK's byteSource does. Each line reads "<name>: ok <detail>" or "<name>: failed <why>".
import { defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { hex, scheme, wasm, webgpu } from "./checks.js";

const SCOPE = { permission: "fs:read", paths: ["~/sandbox-fixture/**"] };

function report(name, run) {
  const line = document.querySelector(`[data-testid=${name}]`);
  return Promise.resolve()
    .then(run)
    .then(
      (detail) => {
        line.textContent = `${name}: ok ${detail}`;
      },
      (error) => {
        line.textContent = `${name}: failed ${error?.message ?? error}`;
      },
    );
}

function worker() {
  const started = startWorker(new URL("./worker.js", import.meta.url));
  return new Promise((done, fail) => {
    started.onmessage = ({ data }) => (data.ok ? done(data.text) : fail(new Error(data.text)));
    started.onerror = (event) => fail(new Error(event.message || "the worker failed"));
    started.postMessage("go");
  }).finally(() => started.terminate());
}

async function range(bridge) {
  const answer = await bridge.call("perm.request", {
    permission: SCOPE,
    reason: "To read a range of a file for the sandbox check",
  });
  if (!answer.granted) throw new Error("not granted");
  const { url } = await bridge.call("fs.url", {
    path: "~/sandbox-fixture/range.bin",
    scope: SCOPE,
  });
  const response = await fetch(url, { headers: { Range: "bytes=4-11" } });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.status !== 206) throw new Error(`status ${response.status}`);
  return `${response.status} ${hex(bytes)}`;
}

defineUiPlugin({
  async mount({ bridge }) {
    document.querySelector("#range").addEventListener("click", () => {
      void report("range", () => range(bridge));
    });
    await Promise.all([
      report("bridge", async () => `${(await bridge.call("perm.query", {})).grants.length} grants`),
      report("scheme", () => scheme(import.meta.url)),
      report("wasm", wasm),
      report("worker", worker),
      report("webgpu", webgpu),
    ]);
  },
});
