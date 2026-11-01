// The one module that draws: decoded RGBA onto a canvas. jsdom has no canvas, so the tests pass a
// stand-in and check the decoders' pixels and the view's state instead.

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} pixels
 */
export function paint(canvas, { width, height, data }) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.putImageData(
    new ImageData(/** @type {Uint8ClampedArray<ArrayBuffer>} */ (data), width, height),
    0,
    0,
  );
}
