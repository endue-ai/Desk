// The one module that draws: decoded RGBA onto a canvas, a band of rows at a time, so a large
// image never holds the main thread: the first band at once, then one band per turn of the event
// loop (a message, which hidden pages do not throttle as they do timers). A canvas that left the
// page stops. jsdom has no canvas, so the tests pass a stand-in and check the decoders' pixels and
// the view's state instead.

/** Pixels per band: about 8 MB of RGBA. */
const BAND = 2 ** 21;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} pixels
 */
export function paint(canvas, { width, height, data }) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = new ImageData(/** @type {Uint8ClampedArray<ArrayBuffer>} */ (data), width, height);
  const rows = Math.max(1, Math.floor(BAND / width));
  let y = 0;
  const band = () => {
    context.putImageData(image, 0, 0, 0, y, width, Math.min(rows, height - y));
    y += rows;
  };
  band();
  if (y >= height) return;
  const turn = new MessageChannel();
  turn.port1.onmessage = () => {
    if (canvas.isConnected) band();
    if (canvas.isConnected && y < height) turn.port2.postMessage(null);
    else turn.port1.close();
  };
  turn.port2.postMessage(null);
}
