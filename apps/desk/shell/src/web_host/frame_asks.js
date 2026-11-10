// A page the desk rests asks it for frames (#134, `frame_asks.rs`). The desk sends a surface no
// begin frame once it has neither painted nor heard anything for a second, so a change the page
// makes on its own (a timer, a fetch, an animation it starts) would wait for one. Whatever may need
// a frame here (a requestAnimationFrame, a change to the document, an animation, media playing, a
// load, a font, a draw on a canvas) looks whether a frame comes within two of the desk's frames;
// when none does, the page asks the desk once, and again only after a frame came.
(() => {
  const native = globalThis.__deskNative;
  const raf = globalThis.requestAnimationFrame;
  if (typeof native?.wake !== "function" || typeof raf !== "function") return;
  const wake = native.wake;
  const later = globalThis.setTimeout;
  // Two desk frames and a little: a surface on the desk's clock gets one within 17 ms.
  const WAIT_MS = 40;
  let looking = false;
  let asked = false;
  const look = () => {
    if (looking) return;
    looking = true;
    let came = false;
    raf.call(globalThis, () => {
      came = true;
      asked = false;
    });
    later.call(
      globalThis,
      () => {
        looking = false;
        if (!came && !asked) {
          asked = true;
          wake();
        }
      },
      WAIT_MS,
    );
  };
  // Each wrapped call looks first; the page's own function does the rest, as it would.
  const wrap = (owner, name) => {
    const own = owner?.[name];
    if (typeof own !== "function") return;
    const wrapped = {
      [name]() {
        if (!looking) look();
        return Reflect.apply(own, this, arguments);
      },
    }[name];
    Object.defineProperty(owner, name, { value: wrapped, writable: true, configurable: true });
  };
  wrap(globalThis, "requestAnimationFrame");
  wrap(globalThis.Element?.prototype, "animate");
  const draws = {
    CanvasRenderingContext2D: [
      "clearRect", "fillRect", "strokeRect", "fill", "stroke", "fillText", "strokeText",
      "drawImage", "putImageData",
    ],
    OffscreenCanvasRenderingContext2D: ["fillRect", "fill", "stroke", "fillText", "drawImage"],
    WebGLRenderingContext: ["clear", "drawArrays", "drawElements"],
    WebGL2RenderingContext: [
      "clear", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced",
      "drawRangeElements",
    ],
    GPUQueue: ["submit"],
    ImageBitmapRenderingContext: ["transferFromImageBitmap"],
  };
  for (const [kind, names] of Object.entries(draws)) {
    for (const name of names) wrap(globalThis[kind]?.prototype, name);
  }
  new MutationObserver(look).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const type of ["load", "play"]) {
    globalThis.addEventListener(type, look, { capture: true, passive: true });
  }
  globalThis.document?.fonts?.addEventListener?.("loadingdone", look);
})();
