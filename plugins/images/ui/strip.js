// The toolbar as one row that scrolls sideways when the window is narrower than its tools, as in a
// window at its first size (#162, draft 08 #9): a wheel turned over it scrolls it, so a mouse with no
// sideways wheel reaches every tool, and `data-more` names the ends that hide tools (start, end or
// both) so the page fades them. A tool that takes the focus is scrolled into sight by the engine.

/** @param {HTMLElement} strip */
export function createStrip(strip) {
  const more = () => {
    const hidden = strip.scrollWidth - strip.clientWidth;
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft < hidden - 1;
    const where = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (where) strip.dataset.more = where;
    else delete strip.dataset.more;
  };
  strip.addEventListener("scroll", more, { passive: true });
  strip.addEventListener(
    "wheel",
    (event) => {
      const sideways = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
      if (sideways || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    },
    { passive: false },
  );
  const win = strip.ownerDocument.defaultView;
  if (win && "ResizeObserver" in win) new win.ResizeObserver(more).observe(strip);
  else win?.addEventListener("resize", more);
  return { more };
}
