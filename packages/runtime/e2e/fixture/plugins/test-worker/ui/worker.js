// The worker side of test.worker: a relative import, a WebAssembly module (add(a, b)) compiled under
// 'wasm-unsafe-eval', and a fetch of the plugin's own file under the frame's connect-src.
import { sum } from "./sum.js";

const ADD = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

self.onmessage = async ({ data }) => {
  const { instance } = await WebAssembly.instantiate(ADD);
  const fetched = await fetch(new URL("./data.txt", import.meta.url))
    .then((response) => response.text())
    .then(
      (text) => text.trim(),
      (error) => `failed: ${error}`,
    );
  self.postMessage({ sum: sum(data), add: instance.exports.add(3, 4), fetched });
};
