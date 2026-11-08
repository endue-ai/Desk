// When the terminal on screen measures itself again (TERM-E05, #538): its panes' box changed (it
// opened, its window was resized, maximized or snapped), the page shows again (a window raised,
// another desktop, the frame woken after an unload, ADR 0070), the device pixel ratio changed (the
// desk scaled, the window moved to another display) or the fonts loaded. At most one fit a frame.

/**
 * @param {{ win: Window, doc: Document, target: Element, fit: () => void }} options
 * @returns {() => void} stops watching
 */
export function watchFit({ win, doc, target, fit }) {
  let frame = 0;
  let stopped = false;
  const schedule = () => {
    if (stopped || frame !== 0) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (!stopped) fit();
    });
  };
  /** @type {Array<() => void>} */
  const offs = [];
  const listen = (
    /** @type {{ addEventListener: Function, removeEventListener: Function }} */ on,
    /** @type {string} */ type,
    /** @type {() => void} */ listener,
  ) => {
    on.addEventListener(type, listener);
    offs.push(() => on.removeEventListener(type, listener));
  };

  const Observer = /** @type {typeof ResizeObserver | undefined} */ (
    /** @type {any} */ (win).ResizeObserver
  );
  if (typeof Observer === "function") {
    const observer = new Observer(schedule);
    observer.observe(target);
    offs.push(() => observer.disconnect());
  }
  listen(win, "resize", schedule);
  listen(win, "pageshow", schedule);
  listen(win, "focus", schedule);
  listen(doc, "visibilitychange", () => {
    if (doc.visibilityState === "visible") schedule();
  });
  if (doc.fonts) listen(doc.fonts, "loadingdone", schedule);

  // A media query matches one ratio: when it stops matching, watch the new one.
  /** @type {(() => void) | null} */
  let offRatio = null;
  const watchRatio = () => {
    if (typeof win.matchMedia !== "function" || stopped) return;
    const query = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    const changed = () => {
      offRatio?.();
      schedule();
      watchRatio();
    };
    query.addEventListener("change", changed);
    offRatio = () => query.removeEventListener("change", changed);
  };
  watchRatio();

  return () => {
    stopped = true;
    for (const off of offs) off();
    offRatio?.();
    if (frame !== 0) win.cancelAnimationFrame(frame);
  };
}
