// A page the desk rests asks it for frames (#134, `frame_asks.rs`). The desk sends a surface no
// begin frame once it has neither painted nor heard anything for a second, so a change the page
// makes on its own (a timer, a fetch, an animation it starts) would wait for one. Whatever may need
// a frame here (a requestAnimationFrame, a change to the document, an animation, media playing, a
// load, a font, a draw on a canvas) wants one, and the next frame meets it. While a want is unmet, a
// frame must come within two of the desk's frames of it or of the last frame; when none does, the
// page asks the desk, and again a second on while none came (an ask lost while its surface was
// hidden or the desk's clock held). So a page that waits on a frame asks until one comes, wherever
// its frames stopped: a want made in a frame, after the frame met the earlier ones (a
// requestAnimationFrame loop's next frame), waits for the next one.
(() => {
  const native = globalThis.__deskNative;
  const raf = globalThis.requestAnimationFrame;
  const clock = globalThis.performance;
  if (typeof native?.wake !== "function" || typeof raf !== "function") return;
  if (typeof clock?.now !== "function") return;
  const wake = native.wake;
  const later = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  const now = () => clock.now();
  // Two desk frames and a little: a surface on the desk's clock gets one within 17 ms.
  const WAIT_MS = 40;
  // How long an ask waits for its frame before the page asks again.
  const AGAIN_MS = 1000;
  // A frame callback of the script's own waits for the next frame. A want asks for it before the
  // page's own function runs, so it comes before every callback the page asked for since: when it
  // runs, the frame meets every want so far.
  let waiting = false;
  // When the page asks unless a frame comes first (0: no want is unmet).
  let due = 0;
  // The timer that looks then, and when it fires.
  let timer;
  let timerAt = Number.POSITIVE_INFINITY;
  const met = () => {
    waiting = false;
    due = 0;
  };
  // An unmet want's frame is due by `at`: the timer looks then, or sooner if it was set to.
  const expect = (at) => {
    due = at;
    if (timerAt <= at) return;
    if (timer !== undefined) cancel.call(globalThis, timer);
    timerAt = at;
    timer = later.call(globalThis, look, Math.max(0, Math.ceil(at - now())));
  };
  // No frame came by `due` for an unmet want: the page asks, and a second on again.
  const look = () => {
    timer = undefined;
    timerAt = Number.POSITIVE_INFINITY;
    if (!due) return;
    if (now() < due) {
      expect(due);
      return;
    }
    wake();
    expect(now() + AGAIN_MS);
  };
  const want = () => {
    if (!waiting) {
      waiting = true;
      raf.call(globalThis, met);
    }
    if (!due) expect(now() + WAIT_MS);
  };
  // Each wrapped call wants a frame first; the page's own function does the rest, as it would.
  const wrap = (owner, name) => {
    const own = owner?.[name];
    if (typeof own !== "function") return;
    const wrapped = {
      [name](...args) {
        want();
        return Reflect.apply(own, this, args);
      },
    }[name];
    Object.defineProperty(owner, name, { value: wrapped, writable: true, configurable: true });
  };
  wrap(globalThis, "requestAnimationFrame");
  wrap(globalThis.Element?.prototype, "animate");
  const draws = {
    CanvasRenderingContext2D: [
      "clearRect",
      "fillRect",
      "strokeRect",
      "fill",
      "stroke",
      "fillText",
      "strokeText",
      "drawImage",
      "putImageData",
    ],
    OffscreenCanvasRenderingContext2D: ["fillRect", "fill", "stroke", "fillText", "drawImage"],
    WebGLRenderingContext: ["clear", "drawArrays", "drawElements"],
    WebGL2RenderingContext: [
      "clear",
      "drawArrays",
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
      "drawRangeElements",
    ],
    GPUQueue: ["submit"],
    ImageBitmapRenderingContext: ["transferFromImageBitmap"],
  };
  for (const [kind, names] of Object.entries(draws)) {
    for (const name of names) wrap(globalThis[kind]?.prototype, name);
  }
  new MutationObserver(want).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const type of ["load", "play"]) {
    globalThis.addEventListener(type, want, { capture: true, passive: true });
  }
  globalThis.document?.fonts?.addEventListener?.("loadingdone", want);
})();
