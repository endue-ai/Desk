// Load the main pdf.js module on demand. Each PDF owns a real SDK worker; the vendored in-frame
// implementation is imported only when that worker cannot start.
import { createPdfWorker } from "./pdf-worker.js";

/** @type {Promise<object> | undefined} */
let loading;

/**
 * pdf.js draws a page in slices, one per animation frame. A frame the webview treats as hidden gets
 * no animation frames, and its pages would stay blank; so each frame request also sets a timer,
 * and whichever comes first runs the slice and cancels the other.
 */
function framesEvenWhenHidden(/** @type {Window} */ win) {
  const native = win.requestAnimationFrame?.bind(win);
  const cancelNative = win.cancelAnimationFrame?.bind(win);
  if (!native || !cancelNative) return;
  /** @type {Map<number, { frame: number, timer: ReturnType<typeof setTimeout> }>} */
  const pending = new Map();
  let next = 0;
  win.requestAnimationFrame = (callback) => {
    const id = ++next;
    const run = (/** @type {number} */ time) => {
      const own = pending.get(id);
      if (!own) return;
      pending.delete(id);
      cancelNative(own.frame);
      clearTimeout(own.timer);
      callback(time);
    };
    pending.set(id, {
      frame: native(run),
      timer: setTimeout(() => run(win.performance.now()), 50),
    });
    return id;
  };
  win.cancelAnimationFrame = (id) => {
    const own = pending.get(id);
    if (!own) return;
    pending.delete(id);
    cancelNative(own.frame);
    clearTimeout(own.timer);
  };
}

export async function loadPdfjs(startWorker) {
  loading ??= import("./vendor/pdf.min.mjs").then((lib) => {
    framesEvenWhenHidden(window);
    return lib;
  });
  const lib = await loading;
  return {
    ...lib,
    createWorker: (signal) =>
      createPdfWorker(lib, startWorker, {
        signal,
        fallback: () => import("./vendor/pdf.worker.min.mjs"),
      }),
  };
}
