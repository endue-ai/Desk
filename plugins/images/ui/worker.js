// The decoding worker: one file's bytes in (transferred), its Decoded out, with the pixels
// transferred and an image the webview decodes as a Blob. A volume (DICOM, NIfTI) stays here, so
// its other slices are decoded on request. Imports are relative: import maps do not reach workers.
import { decode } from "./decode.js";

/**
 * @typedef {import("./decode.js").Decoded} Decoded
 * @typedef {{ type: "decode", bytes: Uint8Array, name: string } | { type: "slice", index: number, n: number }} Request
 * @typedef {(data: unknown, transfer?: Transferable[]) => void} Post
 */

/**
 * What the worker does with each message; the tests run it in-process.
 * @param {Post} post
 */
export function createHandler(post) {
  /** The volume whose slices are asked for next. @type {Decoded | null} */
  let held = null;
  return async (/** @type {Request} */ message) => {
    if (message?.type === "slice") {
      const rgba = held?.slices?.at(message.index);
      post({ type: "slice", n: message.n, rgba }, rgba ? [rgba.buffer] : []);
      return;
    }
    if (message?.type !== "decode") return;
    const progress = (/** @type {number} */ done, /** @type {number} */ total) =>
      post({ type: "progress", done, total });
    const decoded = await decode(message.bytes, message.name, { progress });
    // The float values stay behind: the view draws the tone-mapped RGBA only.
    const { data, float: _float, slices, ...rest } = decoded;
    /** @type {Record<string, unknown>} */
    const out = { ...rest };
    if (decoded.kind === "web" && data)
      out.blob = new Blob([/** @type {BlobPart} */ (data)], { type: decoded.mime });
    if (slices) {
      held = decoded;
      out.slices = { count: slices.count, index: slices.index };
    }
    post({ type: "done", decoded: out }, rest.rgba ? [rest.rgba.buffer] : []);
  };
}

if (typeof document === "undefined" && typeof globalThis.postMessage === "function") {
  const handle = createHandler((data, transfer = []) => globalThis.postMessage(data, transfer));
  globalThis.onmessage = (event) => void handle(event.data);
}
