// The app e2e's sandbox fixture (e2e/specs/sandbox.spec.ts). On mount it runs what a plugin does in
// its renderer: a bridge call, a file of its own over desk-plugin, WebAssembly, a worker (which
// compiles WebAssembly and fetches too) and a WebGPU compute pass. The button asks for
// ~/sandbox-fixture, then reads bytes 4-11 of range.bin through its fs.url URL with a Range request,
// as the SDK's byteSource does; with a lasting grant already there it reads at once. Each line reads
// "<name>: ok <detail>" or "<name>: failed <why>", and goes to the desk's log too (log.write), where
// a release build, which opens no DevTools, shows it.
import { defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { hex, scheme, wasm, webgpu } from "./checks.js";

const SCOPE = { permission: "fs:read", paths: ["~/sandbox-fixture/**"] };

function report(bridge, name, run) {
  const line = document.querySelector(`[data-testid=${name}]`);
  const say = (text) => {
    line.textContent = text;
    bridge.call("log.write", { level: "info", message: `e2e.sandbox ${text}` }).catch(() => {});
  };
  return Promise.resolve()
    .then(run)
    .then(
      (detail) => say(`${name}: ok ${detail}`),
      (error) => say(`${name}: failed ${error?.message ?? error}`),
    );
}

/** Whether a grant this plugin holds covers SCOPE (a lasting one from an earlier answer). */
const covered = (grants) =>
  grants.some(
    (grant) =>
      grant.permission?.permission === SCOPE.permission &&
      grant.permission.paths?.includes(SCOPE.paths[0]),
  );

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
      void report(bridge, "range", () => range(bridge));
    });
    const { grants } = await bridge.call("perm.query", {});
    if (covered(grants)) void report(bridge, "range", () => range(bridge));
    await Promise.all([
      report(bridge, "bridge", () => `${grants.length} grants`),
      report(bridge, "scheme", () => scheme(import.meta.url)),
      report(bridge, "wasm", wasm),
      report(bridge, "worker", worker),
      report(bridge, "webgpu", webgpu),
    ]);
  },
});
